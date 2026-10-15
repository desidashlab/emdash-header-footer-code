import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";

let host: PluginRuntimeTestHost;

type ConfigSnippet = { id: string; where: string; show: string; prefix: string; code: string };
type AnyBlock = Record<string, unknown> & { type: string };

const config = () => host.transport.invokeRoute("config", {}, { method: "GET" }) as Promise<{ snippets: ConfigSnippet[] }>;
const tabs = (page: { blocks: unknown[] }) => (page.blocks[1] as { panels: Array<{ label: string; blocks: AnyBlock[] }> }).panels;
const tab = (page: { blocks: unknown[] }, label: string) => tabs(page).find((p) => p.label === label)!.blocks;
const table = (blocks: AnyBlock[]) => blocks.find((b) => b.type === "table") as unknown as { rows: Array<Record<string, any>> } | undefined;
const texts = (blocks: AnyBlock[]) => JSON.stringify(blocks);
const addCode = (values: Record<string, unknown>) => host.admin.submit("/overview", "save_snippet", values, { blockId: "snippet:" });

beforeEach(async () => {
	host = await createPluginRuntimeTestHost();
	await host.actions.plugin.activate();
});

afterEach(async () => {
	await host.dispose();
});

describe("adding code", () => {
	it("starts empty and shows the empty state", async () => {
		expect((await config()).snippets).toEqual([]);
		const page = await host.admin.loadPage("/overview");
		expect(tabs(page).map((p) => p.label)).toEqual(["Your code", "Common tags", "Setup"]);
		expect(tab(page, "Your code").some((b) => b.type === "empty")).toBe(true);
	});

	it("saves a snippet with its placement and rule, and serves it to the site", async () => {
		const res = await addCode({ name: "Chat widget", code: "<script src=\"https://chat.example.com/w.js\"></script>", where: "body-end", show: "prefix", prefix: "support", active: true });
		expect(res.toast?.message).toBe("Chat widget added");
		const { snippets } = await config();
		expect(snippets).toHaveLength(1);
		expect(snippets[0]).toMatchObject({ where: "body-end", show: "prefix", prefix: "/support" });
		expect(snippets[0]!.code).toContain("chat.example.com");

		const rows = table(tab(await host.admin.loadPage("/overview"), "Your code"))!.rows;
		expect(rows.map((r) => [r.name, r.where, r.show, r.status])).toEqual([["Chat widget", "End of body", "Addresses starting with /support", "Active"]]);
	});

	it("refuses an empty name or code", async () => {
		const res = await addCode({ name: "", code: "<style>a{}</style>" });
		expect(res.toast?.type).toBe("error");
		expect((await config()).snippets).toEqual([]);
	});

	it("falls back to everywhere when the address rule has no path", async () => {
		await addCode({ name: "CSS", code: "<style>a{}</style>", show: "prefix", prefix: "" });
		expect((await config()).snippets[0]).toMatchObject({ show: "all", prefix: "" });
	});
});

describe("managing code", () => {
	it("edits, turns off and on, and deletes", async () => {
		await addCode({ name: "CSS", code: "<style>a{color:red}</style>", where: "head" });
		const id = (await config()).snippets[0]!.id;

		const editView = await host.admin.act("/overview", "snippet_menu", { value: `edit:${id}` });
		expect(texts(tab(editView, "Your code"))).toContain("Edit CSS");
		const edited = await host.admin.submit("/overview", "save_snippet", { name: "Brand CSS", code: "<style>a{color:blue}</style>", where: "head", show: "home", active: true }, { blockId: `snippet:${id}` });
		expect(edited.toast?.message).toBe("Brand CSS saved");
		expect((await config()).snippets).toHaveLength(1);
		expect((await config()).snippets[0]).toMatchObject({ id, show: "home", code: "<style>a{color:blue}</style>" });

		const off = await host.admin.act("/overview", "snippet_menu", { value: `toggle:${id}` });
		expect(off.toast?.message).toBe("Brand CSS turned off");
		expect((await config()).snippets).toEqual([]);
		expect(table(tab(off, "Your code"))!.rows[0]!.status).toBe("Off");

		const on = await host.admin.act("/overview", "snippet_menu", { value: `toggle:${id}` });
		expect(on.toast?.message).toBe("Brand CSS turned on");
		expect((await config()).snippets).toHaveLength(1);

		const gone = await host.admin.act("/overview", "snippet_delete", { value: id });
		expect(gone.toast?.message).toBe("Brand CSS deleted");
		expect((await config()).snippets).toEqual([]);
		expect(table(tab(gone, "Your code"))).toBeUndefined();
	});
});

describe("common tags", () => {
	it("writes Google Analytics from the ID", async () => {
		const res = await host.admin.submit("/overview", "add_ga4", { id: " G-ABC1234XYZ " });
		expect(res.toast?.message).toBe("Google Analytics added");
		const s = (await config()).snippets[0]!;
		expect(s.where).toBe("head");
		expect(s.code).toContain("gtag/js?id=G-ABC1234XYZ");
		expect(s.code).toContain("gtag('config', 'G-ABC1234XYZ')");
	});

	it("rejects an ID that does not look right", async () => {
		const res = await host.admin.submit("/overview", "add_gtm", { id: "G-ABC1234XYZ" });
		expect(res.toast?.type).toBe("error");
		expect((await config()).snippets).toEqual([]);
	});

	it("writes Tag Manager, Meta Pixel and Clarity", async () => {
		await host.admin.submit("/overview", "add_gtm", { id: "GTM-ABC1234" });
		await host.admin.submit("/overview", "add_pixel", { id: "123456789012345" });
		await host.admin.submit("/overview", "add_clarity", { id: "abcdef1234" });
		const list = (await config()).snippets;
		expect(list).toHaveLength(3);
		expect(list[0]!.code).toContain("gtm.js?id='+i");
		expect(list[0]!.code).toContain("'GTM-ABC1234'");
		expect(list[1]!.code).toContain("fbq('init','123456789012345')");
		expect(list[2]!.code).toContain('"abcdef1234"');
	});
});

describe("site verification", () => {
	it("is served in the page head by the site, not through the loader", async () => {
		const res = await host.admin.submit("/overview", "add_verify", { service: "google", code: '<meta name="google-site-verification" content="AbC-123_xyz" />' });
		expect(res.toast?.message).toContain("Google Search Console verification added");
		expect((await config()).snippets).toEqual([]);

		const metas = await host.transport.invokeHook("page:metadata", { page: { url: "https://example.com/", path: "/", locale: null, kind: "custom", pageType: "website", title: null, description: null, canonical: null, image: null } });
		expect(metas).toEqual([{ kind: "meta", name: "google-site-verification", content: "AbC-123_xyz", key: expect.stringMatching(/^hfc:/) }]);

		const rows = table(tab(await host.admin.loadPage("/overview"), "Your code"))!.rows;
		expect(rows[0]).toMatchObject({ name: "Google Search Console verification", where: "Head, served by the site" });
	});

	it("accepts a bare code for Bing and rejects junk", async () => {
		await host.admin.submit("/overview", "add_verify", { service: "bing", code: "1234ABCD5678" });
		const metas = (await host.transport.invokeHook("page:metadata", { page: { url: "https://example.com/", path: "/" } })) as Array<{ name: string; content: string }>;
		expect(metas.map((m) => [m.name, m.content])).toEqual([["msvalidate.01", "1234ABCD5678"]]);

		const bad = await host.admin.submit("/overview", "add_verify", { service: "google", code: "<script>alert(1)</script>" });
		expect(bad.toast?.type).toBe("error");
	});

	it("stops being served when turned off", async () => {
		await host.admin.submit("/overview", "add_verify", { service: "pinterest", code: "abcd1234" });
		const rows = table(tab(await host.admin.loadPage("/overview"), "Your code"))!.rows;
		const id = rows[0]!.remove.value as string;
		await host.admin.act("/overview", "snippet_menu", { value: `toggle:${id}` });
		expect(await host.transport.invokeHook("page:metadata", { page: { url: "https://example.com/", path: "/" } })).toBeNull();
	});
});

describe("setup", () => {
	it("shows the loader line and reports when the site has loaded the code", async () => {
		await addCode({ name: "CSS", code: "<style>a{}</style>" });
		const before = await host.admin.loadPage("/overview");
		expect(texts(tab(before, "Your code"))).toContain("not reaching the site yet");
		expect(texts(tab(before, "Setup"))).toContain("/_emdash/api/plugins/header-footer-code/config");

		await config();
		const after = await host.admin.loadPage("/overview");
		expect(texts(tab(after, "Your code"))).not.toContain("not reaching the site yet");
		expect(texts(tab(after, "Setup"))).toContain("last loaded the code just now");
	});
});
