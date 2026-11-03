import React from 'react';
import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';
import { createRoot } from 'react-dom/client';
import {
  Admin,
  Resource,
  List,
  Datagrid,
  TextField,
  BooleanField,
  Edit,
  SimpleForm,
  SelectInput,
  BooleanInput,
  required,
  Show,
  SimpleShowLayout,
  DateField,
  EditButton,
  ShowButton,
  Title,
  Toolbar,
  SaveButton,
} from 'react-admin';

const context = new URLSearchParams(location.search),
  school = context.get('school'),
  org = context.get('org') || '';
const cache = createCache({
  key: 'hd-admin',
  nonce: document.querySelector('meta[name="csp-nonce"]').content,
  prepend: true,
});
const root =
  '/m1/schools/' +
  encodeURIComponent(school) +
  (org ? '/organizations/' + encodeURIComponent(org) : '');
async function request(path, body) {
  const r = await fetch(path, {
    headers: body ? { 'Content-Type': 'application/json' } : {},
    method: body ? 'POST' : 'GET',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  if (!r.ok) throw Object.assign(Error(d.error?.message || '请求失败'), { status: r.status });
  return d;
}
const records = async (resource) => {
  if (resource === 'members')
    return (await request(root + '/members')).members.map((m) => ({ ...m, id: m.user_id }));
  if (resource === 'audit')
    return (await request('/m1/schools/' + encodeURIComponent(school) + '/audit')).entries.map(
      (e) => ({ ...e, id: e.sequence, detail: JSON.stringify(e.detail) }),
    );
  throw Error('不支持此资源');
};
const one = async (resource, id) => {
  const data = (await records(resource)).find((x) => String(x.id) === String(id));
  if (!data) throw Object.assign(Error('记录已不可用'), { status: 404 });
  return { data };
};
const provider = {
  getList: async (resource, { pagination, sort, filter }) => {
    let data = await records(resource);
    if (filter?.q)
      data = data.filter((x) => JSON.stringify(x).toLowerCase().includes(filter.q.toLowerCase()));
    const allowed =
      resource === 'members'
        ? ['user_id', 'role', 'revision', 'active']
        : ['sequence', 'occurred_at', 'action', 'actor_id'];
    const field = allowed.includes(sort?.field) ? sort.field : allowed[0];
    data.sort(
      (a, b) =>
        String(a[field] ?? '').localeCompare(String(b[field] ?? ''), undefined, { numeric: true }) *
        (sort?.order === 'DESC' ? -1 : 1),
    );
    const total = data.length,
      { page = 1, perPage = 25 } = pagination || {};
    return { data: data.slice((page - 1) * perPage, page * perPage), total };
  },
  getOne: (resource, { id }) => one(resource, id),
  getMany: async (resource, { ids }) => ({
    data: (await records(resource)).filter((x) => ids.map(String).includes(String(x.id))),
  }),
  update: async (resource, { id, data, previousData }) => {
    if (resource !== 'members') throw Error('此记录只读');
    await request(root + '/members', {
      requestId: crypto.randomUUID(),
      userId: id,
      role: data.role,
      active: data.active,
      expectedRevision: previousData.revision,
    });
    return one(resource, id);
  },
  create: async () => {
    throw Error('请通过邀请流程新增成员');
  },
  delete: async () => {
    throw Error('请停用成员，保留交接记录');
  },
  getManyReference: async () => ({ data: [], total: 0 }),
  updateMany: async () => {
    throw Error('不支持批量权限变更');
  },
  deleteMany: async () => {
    throw Error('不支持批量删除');
  },
};
const authProvider = {
  login: async () => {
    location.assign('/auth/login');
  },
  logout: async () => {
    await request('/auth/logout', {});
    location.assign('/m1.html');
  },
  checkAuth: async () => {
    await request('/m0/me');
    await request(root + '/members');
  },
  checkError: async (error) => {
    if (error.status === 401 || error.status === 403) throw error;
  },
  getPermissions: async () => {
    await request(root + '/members');
    return 'scope-owner';
  },
  getIdentity: async () => {
    const me = await request('/m0/me');
    return { id: me.userId, fullName: me.name };
  },
};
function MemberList() {
  return (
    <List title="成员与权限" exporter={false} sort={{ field: 'user_id', order: 'ASC' }}>
      <Datagrid bulkActionButtons={false} rowClick="edit">
        <TextField source="user_id" label="稳定用户 ID" />
        <TextField source="role" label="角色" />
        <BooleanField source="active" label="有效" />
        <TextField source="revision" label="版本" />
        <EditButton label="调整权限" />
      </Datagrid>
    </List>
  );
}
function MemberEdit() {
  return (
    <Edit mutationMode="pessimistic" title="调整成员权限" redirect="list">
      <SimpleForm
        toolbar={
          <Toolbar>
            <SaveButton />
          </Toolbar>
        }
      >
        <TextField source="user_id" label="用户 ID" />
        <TextField source="revision" label="当前版本" />
        <SelectInput
          source="role"
          label="角色"
          validate={required()}
          choices={(org
            ? ['member', 'moderator', 'owner', 'partner']
            : ['student', 'moderator', 'owner', 'partner', 'affiliate']
          ).map((id) => ({ id, name: id }))}
        />
        <BooleanInput source="active" label="有效成员" />
        <p>
          保存时服务端再次检查管理权限和版本。最后一位负责人不能被移除；交接须先添加下一位负责人。
        </p>
      </SimpleForm>
    </Edit>
  );
}
function AuditList() {
  return (
    <List title="最近 100 条审计记录" exporter={false} sort={{ field: 'sequence', order: 'DESC' }}>
      <Datagrid bulkActionButtons={false}>
        <TextField source="sequence" label="流水" />
        <TextField source="action" label="动作" />
        <TextField source="actor_id" label="操作者" />
        <DateField source="occurred_at" showTime label="时间" />
        <ShowButton label="查看" />
      </Datagrid>
    </List>
  );
}
function AuditShow() {
  return (
    <Show>
      <SimpleShowLayout>
        <TextField source="action" />
        <TextField source="actor_id" />
        <TextField source="object_id" />
        <TextField source="detail" />
      </SimpleShowLayout>
    </Show>
  );
}
function Dashboard() {
  return (
    <section style={{ padding: 24, maxWidth: 850 }}>
      <Title title="校园管理" />
      <h1>学校与组织管理</h1>
      <p>
        当前学校：{school} {org && ' · 组织：' + org}
      </p>
      <p>这里使用同一登录账号和服务端权限。角色调整立即影响现有会话；审计记录保留责任人和版本。</p>
      <nav style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <a href="/community.html">组织与论坛</a>
        <a href="/activities.html">活动与志愿</a>
        <a href="/partners.html">合作服务</a>
        <a href="/inbox.html">订阅通知</a>
        <a href="/ranking.html">贡献规则与排名</a>
        <a href="/rewards.html">奖励权益</a>
        <a href="/operations.html">运营排期</a>
        <a href="/environment.html">地点职责与反馈</a>
        <a href="/m1.html">账号、邀请与交接</a>
        <a href="/admin.html">切换管理范围</a>
      </nav>
    </section>
  );
}
async function main() {
  if (!school) {
    const me = await request('/m0/me'),
      host = document.getElementById('app');
    host.replaceChildren();
    const h = document.createElement('h1');
    h.textContent = '选择管理范围';
    host.append(h);
    host.style.cssText = 'max-width:900px;margin:50px auto;padding:24px;font-family:system-ui';
    for (const s of me.schools) {
      const list = (
        await request('/m1/schools/' + encodeURIComponent(s.school_id) + '/organizations')
      ).organizations;
      const scopes = [
        ...(s.role === 'owner' ? [{ name: s.school_id + ' · 全校', id: '' }] : []),
        ...list.map((o) => ({ name: s.school_id + ' · ' + o.name, id: o.org_id })),
      ];
      for (const c of scopes) {
        const a = document.createElement('a');
        a.textContent = c.name;
        a.href =
          '/admin.html?school=' +
          encodeURIComponent(s.school_id) +
          (c.id ? '&org=' + encodeURIComponent(c.id) : '');
        a.style.cssText = 'display:block;padding:14px;border:1px solid #ccc;margin:12px 0';
        host.append(a);
      }
    }
    const p = document.createElement('p');
    p.textContent = '仅当前学校或组织负责人可进入对应管理范围。';
    host.append(p);
    return;
  }
  createRoot(document.getElementById('app')).render(
    <CacheProvider value={cache}>
      <Admin
        title="Hyper Dimension 校园管理"
        dataProvider={provider}
        authProvider={authProvider}
        requireAuth
        dashboard={Dashboard}
      >
        <Resource
          name="members"
          options={{ label: '成员与权限' }}
          list={MemberList}
          edit={MemberEdit}
        />
        {!org && (
          <Resource
            name="audit"
            options={{ label: '审计记录' }}
            list={AuditList}
            show={AuditShow}
          />
        )}
      </Admin>
    </CacheProvider>,
  );
}
main().catch((e) => {
  document.getElementById('app').textContent = '当前无法进入此管理范围：' + e.message;
});
