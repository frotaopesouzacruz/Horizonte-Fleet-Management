import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Service-role client. It bypasses RLS, so it is used for exactly one thing:
 * the Supabase Auth Admin API (inviting a user, reading whether an e-mail
 * already has an account). Every database write that follows goes through the
 * ordinary user client and its RLS policies.
 *
 * Never import this from a client component and never return its results to the
 * browser unfiltered.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured: user provisioning is disabled in this environment.",
    );
  }

  return createSupabaseClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Whether this deployment can provision access (invite users). */
export function canProvisionAccess() {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
