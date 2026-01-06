ALTER TABLE public."soapNotes" ENABLE ROW LEVEL SECURITY;

create policy "Users can view their own soapNotes"
on "public"."soapNotes"
as PERMISSIVE
for SELECT
to authenticated
using (
    user_id = (SELECT auth.uid())
);

create policy "Users can insert their own soapNotes"
on "public"."soapNotes"
as PERMISSIVE
for INSERT
to authenticated
with check (
  user_id = (SELECT auth.uid()) AND
  user_id IS NOT NULL AND
  "patientEncounter_id" IN (
    SELECT id FROM public."patientEncounters" WHERE user_id = (SELECT auth.uid())
  )
);

create policy "Users can update their own soapNotes"
on "public"."soapNotes"
as PERMISSIVE
for UPDATE
to authenticated
using (user_id = (SELECT auth.uid()))
with check (
    user_id = (SELECT auth.uid()) AND
    user_id IS NOT NULL AND
    "patientEncounter_id" IN (
        SELECT id FROM public."patientEncounters" WHERE user_id = (SELECT auth.uid())
    )
);

create policy "Users can delete their own soapNotes"
on "public"."soapNotes"
as PERMISSIVE
for DELETE
to authenticated
using (user_id = (SELECT auth.uid()));

