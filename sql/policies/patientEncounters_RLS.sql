create policy "Users can view their own patientEncounters"
on "public"."patientEncounters"
as PERMISSIVE
for SELECT
to authenticated
using (
    user_id = (SELECT auth.uid())
);

create policy "Users can insert their own patientEncounters"
on "public"."patientEncounters"
as PERMISSIVE
for INSERT
to authenticated
with check (  
    user_id = (SELECT auth.uid()) AND
    user_id IS NOT NULL
);

create policy "Users can update their own patientEncounters"
on "public"."patientEncounters"
as PERMISSIVE
for UPDATE
to authenticated
using (user_id = (SELECT auth.uid()))
with check (  
    user_id = (SELECT auth.uid()) AND
    user_id IS NOT NULL
);

create policy "Users can delete their own patientEncounters"
on "public"."patientEncounters"
as PERMISSIVE
for DELETE
to authenticated
using (user_id = (SELECT auth.uid()));

