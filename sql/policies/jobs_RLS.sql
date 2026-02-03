ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_jobs" ON "jobs"
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "service_role_all" ON "jobs"
  FOR ALL USING (true);