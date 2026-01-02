create policy "Users can view their own recordings"
on "public"."recordings"
as PERMISSIVE
for SELECT
to authenticated
using (
    user_id = (SELECT auth.uid())
);

create policy "Users can insert their own recordings"
on "public"."recordings"
as PERMISSIVE
for INSERT
to authenticated
with check (  
    user_id = (SELECT auth.uid()) AND
    user_id IS NOT NULL AND
    "patientEncounter_id" IN (
        SELECT id FROM public."patientEncounters" WHERE user_id = (select auth.uid())
    )
);

create policy "Users can update their own recordings"
on "public"."recordings"
as PERMISSIVE
for UPDATE
to authenticated
using (user_id = (SELECT auth.uid()))
with check (
    user_id = (SELECT auth.uid()) AND
    user_id IS NOT NULL AND
    "patientEncounter_id" IN (
        SELECT id FROM public."patientEncounters" WHERE user_id = (select auth.uid())
    )
);

create policy "Users can delete their own recordings"
on "public"."recordings"
as PERMISSIVE
for DELETE
to authenticated
using (user_id = (SELECT auth.uid()));
