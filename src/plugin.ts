import type { SandboxedPlugin, PluginContext } from "emdash/plugin";
import type { Block, BlockResponse, FormField } from "@emdash-cms/blocks";

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

const WHERE = ["head", "body-start", "body-end"] as const;
const SHOW = ["all", "home", "prefix"] as const;
type Where = (typeof WHERE)[number];
type Show = (typeof SHOW)[number];

/** One piece of code the owner added. */
interface Snippet {
	id: string;
	name: string;
	code: string;
	where: Where;
	show: Show;
	prefix: string;
	active: boolean;
}

const WHERE_LABEL: Record<Where, string> = { head: "Head", "body-start": "Start of body", "body-end": "End of body" };
const MAX_CODE = 20_000;
const LOADER_SEEN_WINDOW_MS = 10 * 60_000;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, max: number): string {
	return typeof v === "string" ? v.slice(0, max) : "";
}

function pick<T extends string>(v: unknown, allowed: readonly T[], d: T): T {
	return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : d;
}

function newId(): string {
	const bytes = new Uint8Array(6);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function showLabel(s: Snippet): string {
	if (s.show === "home") return "Home page";
	if (s.show === "prefix") return `Addresses starting with ${s.prefix}`;
	return "Everywhere";
}

function cleanPrefix(v: unknown): string {
	const p = str(v, 300).trim();
	if (!p) return "";
	return p.startsWith("/") ? p : `/${p}`;
}

function snippetFrom(v: unknown, existing?: Snippet): Snippet | null {
	const o = isRecord(v) ? v : {};
	const name = str(o.name, 80).trim();
	const code = str(o.code, MAX_CODE).trim();
	if (!name || !code) return null;
	const show = pick(o.show, SHOW, "all");
	const prefix = cleanPrefix(o.prefix);
	return {
		id: existing?.id ?? newId(),
		name,
		code,
		where: pick(o.where, WHERE, existing?.where ?? "head"),
		show: show === "prefix" && !prefix ? "all" : show,
		prefix: show === "prefix" ? prefix : "",
		active: typeof o.active === "boolean" ? o.active : (existing?.active ?? true),
	};
}

function snippetsFrom(v: unknown): Snippet[] {
	if (!Array.isArray(v)) return [];
	const out: Snippet[] = [];
	for (const item of v.slice(0, 200)) {
		if (!isRecord(item)) continue;
		const id = str(item.id, 32);
		const name = str(item.name, 80);
		const code = str(item.code, MAX_CODE);
		if (!id || !name || !code) continue;
		out.push({
			id,
			name,
			code,
			where: pick(item.where, WHERE, "head"),
			show: pick(item.show, SHOW, "all"),
			prefix: cleanPrefix(item.prefix),
			active: item.active !== false,
		});
	}
	return out;
}

async function loadSnippets(ctx: PluginContext): Promise<Snippet[]> {
	return snippetsFrom(await ctx.settings.get<unknown>("snippets"));
}

async function saveSnippets(ctx: PluginContext, list: Snippet[]): Promise<void> {
	await ctx.settings.set("snippets", list);
}

/* ------------------------------------------------------------------ */
/* Common tags                                                         */
/* ------------------------------------------------------------------ */

const ID_RE = {
	ga4: /^G-[A-Z0-9]{6,12}$/,
	gtm: /^GTM-[A-Z0-9]{5,10}$/,
	pixel: /^\d{10,20}$/,
	clarity: /^[a-z0-9]{6,20}$/i,
} as const;

function preset(kind: string, rawId: string): Snippet | null {
	const id = rawId.trim();
	switch (kind) {
		case "ga4":
			if (!ID_RE.ga4.test(id)) return null;
			return {
				id: newId(),
				name: "Google Analytics",
				code: `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>\n<script>\n\twindow.dataLayer = window.dataLayer || [];\n\tfunction gtag(){dataLayer.push(arguments);}\n\tgtag('js', new Date());\n\tgtag('config', '${id}');\n</script>`,
				where: "head",
				show: "all",
				prefix: "",
				active: true,
			};
		case "gtm":
			if (!ID_RE.gtm.test(id)) return null;
			return {
				id: newId(),
				name: "Google Tag Manager",
				code: `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');</script>`,
				where: "head",
				show: "all",
				prefix: "",
				active: true,
			};
		case "pixel":
			if (!ID_RE.pixel.test(id)) return null;
			return {
				id: newId(),
				name: "Meta Pixel",
				code: `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${id}');fbq('track','PageView');</script>`,
				where: "head",
				show: "all",
				prefix: "",
				active: true,
			};
		case "clarity":
			if (!ID_RE.clarity.test(id)) return null;
			return {
				id: newId(),
				name: "Microsoft Clarity",
				code: `<script>(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${id}");</script>`,
				where: "head",
				show: "all",
				prefix: "",
				active: true,
			};
	}
	return null;
}

/* ------------------------------------------------------------------ */
/* The line for the theme                                              */
/* ------------------------------------------------------------------ */

function loader(pluginId: string): string {
	const url = `/_emdash/api/plugins/${pluginId}/config`;
	return [
		`<script is:inline>`,
		`\t/* Header & Footer Code: loads the code you manage in the admin. */`,
		`\t(function () {`,
		`\t\tfunction place(s, el) { var t = s.where === "head" ? document.head : document.body; if (s.where === "body-start") t.insertBefore(el, t.firstChild); else t.appendChild(el); }`,
		`\t\tfunction script(n) { var el = document.createElement("script"); for (var i = 0; i < n.attributes.length; i++) el.setAttribute(n.attributes[i].name, n.attributes[i].value); el.text = n.text; return el; }`,
		`\t\tfunction run(s) {`,
		`\t\t\tvar box = document.createElement("template"); box.innerHTML = s.code;`,
		`\t\t\tvar nodes = Array.prototype.slice.call(box.content.childNodes);`,
		`\t\t\tfor (var i = 0; i < nodes.length; i++) {`,
		`\t\t\t\tvar n = nodes[i];`,
		`\t\t\t\tif (n.nodeType === 1 && n.tagName === "SCRIPT") { place(s, script(n)); continue; }`,
		`\t\t\t\tplace(s, n);`,
		`\t\t\t\tif (n.querySelectorAll) { var inner = n.querySelectorAll("script"); for (var k = 0; k < inner.length; k++) inner[k].parentNode.replaceChild(script(inner[k]), inner[k]); }`,
		`\t\t\t}`,
		`\t\t}`,
		`\t\tfunction apply(list) {`,
		`\t\t\tvar p = location.pathname;`,
		`\t\t\tfor (var i = 0; i < list.length; i++) {`,
		`\t\t\t\tvar s = list[i];`,
		`\t\t\t\tif (s.show === "home" && p !== "/") continue;`,
		`\t\t\t\tif (s.show === "prefix" && p.indexOf(s.prefix) !== 0) continue;`,
		`\t\t\t\trun(s);`,
		`\t\t\t}`,
		`\t\t}`,
		`\t\tfetch("${url}").then(function (r) { return r.json(); }).then(function (j) {`,
		`\t\t\tvar list = (j && j.data && j.data.snippets) || [];`,
		`\t\t\tif (document.body) apply(list); else document.addEventListener("DOMContentLoaded", function () { apply(list); });`,
		`\t\t}).catch(function () {});`,
		`\t})();`,
		`</script>`,
	].join("\n");
}

/* ------------------------------------------------------------------ */
/* Admin page                                                          */
/* ------------------------------------------------------------------ */

type Interaction = {
	type?: string;
	action_id?: string;
	block_id?: string;
	value?: unknown;
	values?: Record<string, unknown>;
};

const TABS = { snippets: 0, common: 1, setup: 2 } as const;

async function loaderStatus(ctx: PluginContext): Promise<{ seen: boolean; ago: string }> {
	const at = await ctx.kv.get<number>("loaderSeenAt");
	if (!at) return { seen: false, ago: "" };
	const mins = Math.max(0, Math.round((Date.now() - at) / 60_000));
	const ago = mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`;
	return { seen: true, ago };
}

function snippetForm(editing?: Snippet): Block[] {
	const fields: FormField[] = [
		{ type: "text_input", action_id: "name", label: "Name", placeholder: "Google Analytics", initial_value: editing?.name ?? "" },
		{
			type: "text_input",
			action_id: "code",
			label: "Code",
			placeholder: "<script>…</script>, <style>…</style> or any HTML",
			initial_value: editing?.code ?? "",
			multiline: true,
		},
		{
			type: "select",
			action_id: "where",
			label: "Where",
			options: WHERE.map((w) => ({ value: w, label: WHERE_LABEL[w] })),
			initial_value: editing?.where ?? "head",
		},
	];
	fields.push(
		{
			type: "select",
			action_id: "show",
			label: "Show on",
			options: [
				{ value: "all", label: "Everywhere" },
				{ value: "home", label: "Home page only" },
				{ value: "prefix", label: "Addresses starting with…" },
			],
			initial_value: editing?.show ?? "all",
		},
		{
			type: "text_input",
			action_id: "prefix",
			label: "Address starts with",
			placeholder: "/blog",
			initial_value: editing?.prefix ?? "",
			condition: { field: "show", eq: "prefix" },
		},
	);
	fields.push({ type: "toggle", action_id: "active", label: "Active", initial_value: editing?.active ?? true });
	return [
		{ type: "section", text: editing ? `Edit ${editing.name}` : "Add code" },
		{
			type: "form",
			// The nonce makes each render a fresh form, so the fields clear after an add instead of keeping the last values.
			block_id: `snippet:${editing?.id ?? ""}#${Date.now().toString(36)}`,
			fields,
			submit: { label: editing ? "Save changes" : "Add", action_id: "save_snippet" },
		},
	];
}

async function snippetsTab(ctx: PluginContext, list: Snippet[], editing?: Snippet): Promise<Block[]> {
	const blocks: Block[] = [];
	const status = await loaderStatus(ctx);
	if (list.some((s) => s.active) && !status.seen) {
		blocks.push({
			type: "banner",
			variant: "alert",
			title: "Your code is not reaching the site yet",
			description: "Add the block from the Setup tab to your theme once.",
		});
	}
	if (list.length === 0) {
		blocks.push({
			type: "empty",
			title: "No code added yet",
			description: "Add Google Analytics or a pixel from the Common tags tab, or paste any code below.",
		});
	} else {
		blocks.push({
			type: "table",
			page_action_id: "snippets_page",
			columns: [
				{ key: "name", label: "Name" },
				{ key: "where", label: "Where" },
				{ key: "show", label: "Shows on" },
				{ key: "status", label: "Status", format: "badge" },
				{ key: "menu", label: "", format: "element" },
				{ key: "remove", label: "", format: "element" },
			],
			rows: list.map((s) => ({
				name: s.name,
				where: WHERE_LABEL[s.where],
				show: showLabel(s),
				status: s.active ? "Active" : "Off",
				menu: {
					type: "menu",
					action_id: "snippet_menu",
					label: "Edit",
					items: [
						{ label: "Edit", value: `edit:${s.id}` },
						{ label: s.active ? "Turn off" : "Turn on", value: `toggle:${s.id}` },
					],
				},
				remove: {
					type: "button",
					action_id: "snippet_delete",
					label: "Delete",
					style: "danger",
					value: s.id,
					confirm: { title: `Delete ${s.name}?`, text: "It stops running on your site right away.", confirm: "Delete", deny: "Keep", style: "danger" },
				},
			})),
		});
	}
	blocks.push({ type: "divider" }, ...snippetForm(editing));
	return blocks;
}

function commonTab(): Block[] {
	const one = (title: string, action: string, label: string, placeholder: string, note: string): Block[] => [
		{ type: "section", text: title },
		{ type: "context", text: note },
		{
			type: "form",
			block_id: action,
			fields: [{ type: "text_input", action_id: "id", label, placeholder }],
			submit: { label: "Add", action_id: action },
		},
		{ type: "divider" },
	];
	return [
		{ type: "context", text: "Paste only the ID. The code is written for you and placed in the head of every page." },
		...one("Google Analytics", "add_ga4", "Measurement ID", "G-XXXXXXXXXX", "Found in Analytics under Admin, Data streams."),
		...one("Google Tag Manager", "add_gtm", "Container ID", "GTM-XXXXXXX", "Found at the top of your Tag Manager workspace."),
		...one("Meta Pixel", "add_pixel", "Pixel ID", "123456789012345", "Found in Meta Events Manager."),
		...one("Microsoft Clarity", "add_clarity", "Project ID", "abcdefghij", "Found in Clarity under Settings, Setup."),
		{ type: "context", text: "Google and Bing site verification are built into EmDash: Settings, then SEO." },
	];
}

async function setupTab(ctx: PluginContext): Promise<Block[]> {
	const status = await loaderStatus(ctx);
	return [
		status.seen
			? { type: "banner", title: "Working", description: `Your site last loaded the code ${status.ago}.` }
			: { type: "banner", title: "One line to add", description: "Your site has not loaded the code yet. Add the line below to your theme." },
		{ type: "section", text: "Paste this once into the head of your base layout, usually src/layouts/Base.astro." },
		{ type: "code", language: "tsx", code: loader(ctx.plugin.id) },
		{ type: "context", text: "Everything you add or change here reaches the site within a minute, without touching the theme again." },
	];
}

async function page(ctx: PluginContext, tab: number, editing?: Snippet): Promise<BlockResponse> {
	const list = await loadSnippets(ctx);
	return {
		blocks: [
			{ type: "header", text: "Header & Footer Code" },
			{
				type: "tab",
				default_tab: tab,
				panels: [
					{ label: "Your code", blocks: await snippetsTab(ctx, list, editing) },
					{ label: "Common tags", blocks: commonTab() },
					{ label: "Setup", blocks: await setupTab(ctx) },
				],
			},
		],
	};
}

async function handleAdmin(ctx: PluginContext, i: Interaction): Promise<BlockResponse> {
	const v = i.values ?? {};
	const toast = (message: string, type: "success" | "error" | "info" = "success") => ({ toast: { type, message } });
	const list = await loadSnippets(ctx);

	if (i.type === "form_submit") {
		switch (i.action_id) {
			case "save_snippet": {
				const id = typeof i.block_id === "string" && i.block_id.startsWith("snippet:") ? i.block_id.slice(8).split("#")[0]! : "";
				const existing = id ? list.find((s) => s.id === id) : undefined;
				const next = snippetFrom(v, existing);
				if (!next) return { ...(await page(ctx, TABS.snippets, existing)), ...toast("A name and the code are both needed.", "error") };
				const saved = existing ? list.map((s) => (s.id === existing.id ? next : s)) : [...list, next];
				await saveSnippets(ctx, saved);
				return { ...(await page(ctx, TABS.snippets)), ...toast(existing ? `${next.name} saved` : `${next.name} added`) };
			}
			case "add_ga4":
			case "add_gtm":
			case "add_pixel":
			case "add_clarity": {
				const kind = i.action_id.slice(4);
				const made = preset(kind, str(v.id, 40));
				if (!made) return { ...(await page(ctx, TABS.common)), ...toast("That ID does not look right. Check it and try again.", "error") };
				await saveSnippets(ctx, [...list, made]);
				return { ...(await page(ctx, TABS.snippets)), ...toast(`${made.name} added`) };
			}
		}
	}

	if (i.type === "block_action") {
		switch (i.action_id) {
			case "snippet_menu": {
				const [verb, id] = typeof i.value === "string" ? i.value.split(":", 2) : ["", ""];
				const s = list.find((x) => x.id === id);
				if (!s) return page(ctx, TABS.snippets);
				if (verb === "edit") return page(ctx, TABS.snippets, s);
				if (verb === "toggle") {
					await saveSnippets(ctx, list.map((x) => (x.id === id ? { ...x, active: !x.active } : x)));
					return { ...(await page(ctx, TABS.snippets)), ...toast(s.active ? `${s.name} turned off` : `${s.name} turned on`) };
				}
				return page(ctx, TABS.snippets);
			}
			case "snippet_delete": {
				const id = typeof i.value === "string" ? i.value : "";
				const s = list.find((x) => x.id === id);
				if (!s) return page(ctx, TABS.snippets);
				await saveSnippets(ctx, list.filter((x) => x.id !== id));
				return { ...(await page(ctx, TABS.snippets)), ...toast(`${s.name} deleted`) };
			}
		}
	}

	return page(ctx, TABS.snippets);
}

/* ------------------------------------------------------------------ */
/* The plugin                                                          */
/* ------------------------------------------------------------------ */

const plugin: SandboxedPlugin = {
	routes: {
		/** Public: the active code snippets. Same for every visitor, so it may be cached for a minute. */
		config: {
			public: true,
			methods: ["GET"],
			request: { body: "none" },
			cacheControl: "public, max-age=60",
			handler: async (_routeCtx, ctx) => {
				const list = await loadSnippets(ctx);
				const seen = (await ctx.kv.get<number>("loaderSeenAt")) ?? 0;
				if (Date.now() - seen > LOADER_SEEN_WINDOW_MS) await ctx.kv.set("loaderSeenAt", Date.now());
				return {
					snippets: list
						.filter((s) => s.active)
						.map((s) => ({ id: s.id, where: s.where, show: s.show, prefix: s.prefix, code: s.code })),
				};
			},
		},

		/** The admin page. */
		admin: {
			permission: "plugins:manage",
			handler: async (routeCtx, ctx) => handleAdmin(ctx, (routeCtx.input ?? {}) as Interaction),
		},
	},
};

export default plugin;
