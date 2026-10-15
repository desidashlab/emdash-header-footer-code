## Two steps

1. In your EmDash admin open **Registry**, search for **Header & Footer Code**, and click **Install**. It asks for no permissions.
2. Open **Header & Footer Code** in the left menu, go to the **Setup** tab, and paste the short block it shows into the head of your base layout, usually `src/layouts/Base.astro`. If someone else built your site, send them that block.

From then on everything is done in the admin. Add Google Analytics, Tag Manager, a Meta Pixel or Clarity from the **Common tags** tab by pasting the ID, or paste any code on the **Your code** tab. Changes reach the site within a minute.

Site verification tags (Google Search Console, Bing, Pinterest) are served in the page head by the site itself, so they work even before step 2.
