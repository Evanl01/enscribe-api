-- Enable row level security
ALTER TABLE public."dotPhrases" ENABLE ROW LEVEL SECURITY;

-- Users can view their own dot phrases
create policy "Users can view their own dot phrases"
on public."dotPhrases"
as PERMISSIVE
for SELECT
to authenticated
using (
    user_id = (SELECT auth.uid())
);

-- Users can insert their own dot phrases
create policy "Users can insert their own dot phrases"
on public."dotPhrases"
as PERMISSIVE
for INSERT
to authenticated
with check (
    user_id = (SELECT auth.uid()) AND
    user_id IS NOT NULL
);

-- Users can update their own dot phrases
create policy "Users can update their own dot phrases"
on public."dotPhrases"
as PERMISSIVE
for UPDATE
to authenticated
using (user_id = (SELECT auth.uid()))
with check (
    user_id = (SELECT auth.uid()) AND
    user_id IS NOT NULL
);

-- Users can delete their own dot phrases
create policy "Users can delete their own dot phrases"
on public."dotPhrases"
as PERMISSIVE
for DELETE
to authenticated
using (user_id = (SELECT auth.uid()));
