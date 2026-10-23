import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    return Response.json({ error: "Server configuration unavailable" }, { status: 500 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { data: proofs, error: readError } = await admin
    .from("subscription_payment_proofs")
    .select("id,proof_path,created_at")
    .lt("created_at", cutoff)
    .not("proof_path", "is", null)
    .limit(500);

  if (readError) return Response.json({ error: readError.message }, { status: 500 });

  const valid = (proofs ?? []).filter(
    (proof) => typeof proof.proof_path === "string" && proof.proof_path.length > 0,
  );
  if (!valid.length) return Response.json({ deleted: 0, message: "No expired proof files" });

  const paths = valid.map((proof) => proof.proof_path as string);
  const { error: storageError } = await admin.storage.from("payment-proofs").remove(paths);
  if (storageError) return Response.json({ error: storageError.message }, { status: 500 });

  const ids = valid.map((proof) => proof.id);
  const { error: updateError } = await admin
    .from("subscription_payment_proofs")
    .update({ proof_path: null, proof_deleted_at: new Date().toISOString() })
    .in("id", ids);

  if (updateError) {
    return Response.json({ error: updateError.message, files_deleted: paths.length }, { status: 500 });
  }

  return Response.json({ deleted: paths.length });
});
