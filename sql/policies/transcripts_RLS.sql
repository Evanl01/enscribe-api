ALTER TABLE public."transcripts" ENABLE ROW LEVEL SECURITY;

create policy "Users can view their own transcripts"
on "public"."transcripts"
as PERMISSIVE
for SELECT
to authenticated
using (
    user_id = (SELECT auth.uid())
);

create policy "Users can insert their own transcripts"
on "public"."transcripts"
as PERMISSIVE
for INSERT
to authenticated
with check (
    user_id = (SELECT auth.uid()) AND
    user_id IS NOT NULL AND
    recording_id IN (
        SELECT id FROM "recordings" WHERE user_id = (SELECT auth.uid())
    )
);

create policy "Users can update their own transcripts"
on "public"."transcripts"
as PERMISSIVE
for UPDATE
to authenticated
using (user_id = (SELECT auth.uid()))
with check (
    user_id = (SELECT auth.uid()) AND
    user_id IS NOT NULL AND
    recording_id IN (
        SELECT id FROM "recordings" WHERE user_id = (SELECT auth.uid())
    )
);

create policy "Users can delete their own transcripts"
on "public"."transcripts"
as PERMISSIVE
for DELETE
to authenticated
using (user_id = (SELECT auth.uid()));
