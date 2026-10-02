-- Let signed-in users subscribe to server broadcast nudges on the shared
-- admin workspace channel (New Requests + Email responses instant refresh).
CREATE POLICY "authenticated can receive workspace broadcasts"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  (SELECT realtime.topic()) = 'pilot2-workspace'
  AND realtime.messages.extension IN ('broadcast')
);
