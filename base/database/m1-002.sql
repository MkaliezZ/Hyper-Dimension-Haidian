-- Organization delegates may invite people only into their organization.
-- A new organization-only account does not gain general school privileges.
ALTER TABLE hd_memberships DROP CONSTRAINT hd_memberships_role_check;
ALTER TABLE hd_memberships ADD CONSTRAINT hd_memberships_role_check CHECK(role IN ('student','moderator','owner','partner','affiliate'));
