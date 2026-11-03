-- Scope metadata comes from the immutable original envelope; scores/rules/events are not rewritten.
UPDATE hd_contributions c SET scope_id=coalesce(e.envelope->>'organizationId','')
 FROM hd_events e WHERE e.event_id=c.event_id;
