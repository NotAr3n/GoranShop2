# GoranShop – Step 1 (Vercel + Postgres edition)

Storefront (`/`), admin panel (`/admin`) and JSON API (`/api`) on **Vercel**, data in **Postgres** (Neon).
Everything the storefront shows comes from the database, so changes made in the admin appear on the store immediately.
Uploaded images are stored in the database too (no extra storage service needed).

## Deploy on Vercel (step by step)
1. Push this folder to GitHub (replace the old files; `.env` and `node_modules` are git-ignored).
2. In Vercel, import the repo (framework preset: **Other**). Leave build settings empty.
3. In the Vercel project: **Storage** tab -> create a **Neon (Postgres)** database and connect it to the project. It adds `DATABASE_URL` / `POSTGRES_URL` automatically.
4. **Settings -> Environment Variables**, add (Production):
   - `JWT_SECRET` = long random string (64+ characters)
   - `ADMIN_EMAIL` = your email
   - `ADMIN_PASSWORD` = strong password (8+ characters)
5. **Deployments -> Redeploy** (env vars only apply to new deployments).
6. Open your Vercel URL. The first request creates the tables and sample data (takes a few seconds). Then open `/admin` and sign in with the email/password from step 4.
7. Settings -> upload your logo and favicon, click **Use colors from my logo**, then **Save settings**.
8. Add your domain under **Settings -> Domains** and follow the DNS instructions.

If you see "Server not configured", a variable from step 3 or 4 is missing.

## Run locally
```bash
npm install
cp .env.example .env     # fill DATABASE_URL (a free Neon database works) and the rest
npm start                # http://localhost:3000  (admin: /admin)
```
Without `NODE_ENV=production`, the first run also creates demo logins: admin `admin@goranshop.com` / `Admin123!`, customer `customer@example.com` / `Customer123!`.
`CONFIRM=yes npm run db:reset` wipes all data.

## Structure
```
api/index.js      Vercel entry (exports the Express app)
server/app.js     auth, storefront API, admin API, permissions
server/db.js      Postgres connection, schema, seed data
server/local.js   local dev server
public/           storefront (index.html, store.js) and admin (admin.html, admin.js)
vercel.json       routes /api and /uploads to the function
```

## Using the admin
- **Products:** add/edit/duplicate/hide/delete, variants with their own price/stock/SKU, images, flags (Featured/New/Best seller), SEO, bulk actions, filters, CSV export.
- **Categories, Inventory (logged), Orders (cancel/return restocks), Customers, Settings** (store info, logo, favicon, colors, hero, homepage sections, shipping, payments, social, SEO).
- Admin permissions are checked on the server for every route.

## Limits to know
- Images over 4 MB are rejected; the admin shrinks large photos in the browser before upload.
- Login rate limiting is stored in the database, so it works across Vercel instances.
- Free Neon databases pause when idle, so the first request after a quiet period can be slow.

## Next steps
2. Coupons at checkout + admin, wishlist, saved addresses, reviews + moderation
3. Users & Roles screen, notifications page, media library
4. CMS pages/FAQ/banners, 5. Analytics, product import, sitemap/robots/structured data
6. Email notifications, online payments, strict CSP, forgot-password
