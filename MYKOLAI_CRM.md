# Separate Mykolai block in Cups CRM

This change adds a «Миколайчик» navigation item to the current production Cups CRM. It reads existing `mykolai_orders` directly and refreshes every 30 seconds while the block is open. New orders do not need copying into clothing or Teplo tables.

## Isolation

- Keep the production clothing pages, Nova Poshta functions, Teplo importer, product catalog and payment handlers unchanged.
- The new function verifies the caller with Supabase Auth, then checks an active `crm_access` membership with role `admin`, `manager`, or `orders_manager`.
- Only `mykolai_orders` is read or updated. Status updates use the order UUID and previous status to reject concurrent edits. Payment fields are never written.
- Source photos and selected mockups remain in the private `mykolai-orders` bucket. Signed URLs are issued only for files listed on that order, for 300 seconds.
- No schema, grants, RLS policies, storefront checkout or generation changes are required. Do not put a service-role key in Vercel or frontend code.
- This block provides order details and status handling. Existing Teplo shipping controls are not reused for these independent source records.

## Release requirements

Production CRM was deployed manually as `dpl_BjcP4n1mrxnSiXztddbime7TW2VP`; repository `main` does not contain its current clothing pages or API functions. **Do not deploy this repository wholesale.**

1. With authorized Supabase project access, deploy `supabase/functions/mykolai-crm` to `fsihlzzjewhxpogvjapu`, leaving JWT verification enabled. `SUPABASE_SERVICE_ROLE_KEY` stays in the Edge Function environment. Validate an authenticated CRM reader and confirm unauthenticated/disabled users are rejected.
2. Refresh the latest production CRM deployment. Compare `cups.html` against this baseline; reapply the three narrow changes if production changed in the meantime.
3. Publish by preserving every other source file from the latest deployed CRM. Replace only `cups.html` and add `mykolai-crm.js`; keep its existing project, environment, rewrites, domains and credentials unchanged.
4. Sign in to CRM, open Cups → Mykolai, confirm existing source orders appear with correct names, red/blue details and private media. Verify clothing and Teplo screens still work. Do not create a customer order, send a message or charge a payment during this check.

Supabase connection currently returns no projects and `get_edge_function` is denied. Activation is blocked until access to the named project is restored. No production deployment has been made.

## Tests

`node --test tests/mykolai-crm.test.mjs`

Eight tests cover membership checks, origin rejection, query validation, table isolation, private media scoping, concurrent status updates, unpaid online fulfillment and exact preservation of the original Cups CRM except the three insertion points.
