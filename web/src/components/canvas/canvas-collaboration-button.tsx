import { useEffect, useState } from 'react';
import { Copy, LogOut, Users, RefreshCw, CircleAlert } from 'lucide-react';
import copy from 'copy-to-clipboard';
import { App, Button, Input, Modal, Select, Space } from 'antd';
import { useThemeStore } from '@/stores/use-theme-store';
import { canvasThemes } from '@/lib/canvas-theme';
import { useCollaborationStore } from '@/stores/canvas/use-collaboration-store';
import { collaborationName, collaborationOperation } from '@/lib/canvas/collaboration-presence';

export function CanvasCollaborationButton() {
    const theme = canvasThemes[useThemeStore(state => state.theme)];
    const status = useCollaborationStore(state => state.status || 'offline');
    const role = useCollaborationStore(state => state.role);
    const defaultInvite = useCollaborationStore(state => state.invite);
    const invitations = useCollaborationStore(state => state.invitations);
    const members = useCollaborationStore(state => state.members || 0);
    const error = useCollaborationStore(state => state.error);
    const syncing = useCollaborationStore(state => state.syncing);
    const host = useCollaborationStore(state => state.host);
    const join = useCollaborationStore(state => state.join);
    const leave = useCollaborationStore(state => state.leave);
    const retry = useCollaborationStore(state => state.retry);
    const peers = useCollaborationStore(state => state.peers);
    const self = useCollaborationStore(state => state.self);
    const nickname = useCollaborationStore(state => state.nickname);
    const rename = useCollaborationStore(state => state.rename);
    const locatePeer = useCollaborationStore(state => state.locatePeer);
    const [open, setOpen] = useState(false);
    const [joinInvite, setJoinInvite] = useState('');
    const [selectedInvite, setSelectedInvite] = useState('');
    const [busy, setBusy] = useState(false);
    const [draftName, setDraftName] = useState('');
    useEffect(() => { if (open) setDraftName(nickname || ''); }, [open, nickname]);
    const { message } = App.useApp();
    const online = status === 'online';
    const invite = invitations?.some(item => item.invite === selectedInvite) ? selectedInvite : defaultInvite;
    const run = async (action: () => Promise<void>) => { setBusy(true); try { await action(); } catch (reason) { message.error(reason instanceof Error ? reason.message : '协作操作失败'); } finally { setBusy(false); } };
    const reconnecting = status === 'reconnecting';
    const label = reconnecting ? '协作重连中' : error ? '协作需处理' : online ? `${syncing ? '同步中' : '协作中'} · ${members}人` : '协作';
    const color = reconnecting || error ? theme.collaboration[3] : online ? theme.collaboration[2] : theme.node.text;
    const detail = reconnecting ? '连接中断，每 3 秒自动重连；当前修改保留本机' : error ? error : online ? `${role === 'host' ? '你是房主' : '已加入房间'}，${members} 人在线${syncing ? '，正在同步原始素材' : '，操作实时同步'}` : '共享画布或加入局域网协作';
    const people = self ? [self, ...peers] : peers;
    const memberColor = (color: number) => theme.collaboration[color % theme.collaboration.length];
    if (!window.oneYesDesktop?.collaboration) return null;
    return <>
        <div className="inline-flex min-w-0 items-center gap-2" data-canvas-shortcuts-ignore data-canvas-no-zoom>
        <Button type="text" size="small" aria-label={label} title={detail} data-collaboration-status={reconnecting ? 'reconnecting' : error ? 'error' : online ? syncing ? 'syncing' : 'online' : 'offline'} icon={reconnecting || (online && syncing) ? <RefreshCw className="size-3.5 motion-safe:animate-spin" /> : error ? <CircleAlert className="size-3.5" /> : <span className="relative inline-flex"><Users className="size-4" />{online && <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full" style={{ background: color, outline: `2px solid ${theme.canvas.background}` }} />}</span>} onClick={() => setOpen(true)} style={{ color }}>
            <span role="status" aria-live="polite">{label}</span>
        </Button>
        {online && <div className="flex max-w-60 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="协作成员标识">
            {people.map(member => {
                const peer = peers.find(peer => peer.id === member.id), operation = peer ? collaborationOperation(peer) : '你', name = collaborationName(member, people);
                const canLocate = peer && locatePeer && (peer.cursor || peer.selected.length);
                return <button key={member.id} type="button" data-collaboration-member={member.id} aria-label={`${canLocate ? '定位' : '查看'}协作者 ${name}`} title={`${name}${member.role === 'host' ? '（房主）' : ''} · ${operation}${canLocate ? '，点击定位' : ''}`} onClick={() => canLocate ? locatePeer!(member.id) : setOpen(true)} className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-1 text-xs hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-white/10" style={{color:memberColor(member.color)}}><span className="inline-flex size-5 items-center justify-center text-sm font-semibold" aria-hidden>{Array.from(member.name)[0]}</span><span className="max-w-20 truncate">{peer ? name : '你'}</span>{peer?.action && <span className="size-1 rounded-full motion-safe:animate-pulse" style={{background:'currentColor'}}/>}</button>;
            })}
        </div>}
        </div>
        <Modal title="局域网协作" open={open} onCancel={() => setOpen(false)} footer={null} centered width={480} data-canvas-shortcuts-ignore data-canvas-no-zoom>
            <div className="space-y-4" style={{ color: theme.node.text }}>
                <div className="flex items-center gap-2 text-sm" style={{ color: theme.node.muted }}>
                    <Users className="size-4" />{online ? `${role === 'host' ? '你是房主' : '已加入房间'} · ${members} 人在线` : reconnecting ? '正在自动重新连接，当前修改保留本机' : '同一 Wi-Fi 或有线网络，一起创作'}
                </div>
                <div className="space-y-1.5"><label className="text-xs" htmlFor="collaboration-nickname" style={{color:theme.node.muted}}>协作昵称</label><Space.Compact className="w-full"><Input id="collaboration-nickname" value={draftName} onChange={event=>setDraftName(event.target.value)} placeholder={self?.name || '默认使用 OneYes 用户名'} onPressEnter={()=>{if(rename&&!busy)void run(async()=>{await rename(draftName);message.success('协作昵称已更新');});}}/><Button disabled={!rename||busy||draftName===(nickname||'')} onClick={()=>void run(async()=>{await rename!(draftName);message.success('协作昵称已更新');})}>保存</Button></Space.Compact><p className="text-xs" style={{color:theme.node.muted}}>留空使用 OneYes 用户名，未登录时显示访客标识；昵称修改会实时同步。</p></div>
                {online && <div className="space-y-1" aria-label="在线协作者">{people.map(member=>{
                    const peer=peers.find(peer=>peer.id===member.id),canLocate=peer&&locatePeer&&(peer.cursor||peer.selected.length);
                    return <button key={member.id} type="button" disabled={!canLocate} data-collaboration-member-detail={member.id} className="flex w-full items-center gap-2 rounded px-1 py-1.5 text-left text-xs enabled:hover:bg-black/5 enabled:dark:hover:bg-white/10" onClick={()=>{locatePeer?.(member.id);setOpen(false);}} style={{color:theme.node.text}}><span className="inline-flex size-6 shrink-0 items-center justify-center font-semibold" style={{color:memberColor(member.color)}} aria-hidden>{Array.from(member.name)[0]}</span><span className="min-w-0 flex-1"><span className="block break-words">{collaborationName(member,people)}{!peer?'（你）':''}{member.role==='host'?' · 房主':''}</span><span className="mt-0.5 block" style={{color:theme.node.muted}}>{peer?collaborationOperation(peer):'本机操作'}{canLocate?' · 点击定位':''}</span></span><span className="size-1.5 shrink-0 rounded-full" style={{background:memberColor(member.color)}}/></button>;
                })}</div>}
                {reconnecting && <p className="text-xs leading-5" style={{ color: theme.node.muted }}>每 3 秒自动重试，连接恢复后合并修改。请让房主保持软件运行，并确认连接同一局域网；你也可以退出协作保留本地副本。</p>}
                {invite && <div className="space-y-2"><div className="text-xs" style={{ color: theme.node.muted }}>把邀请内容发给同一局域网内的协作者</div>{invitations && invitations.length > 1 && <Select className="w-full" aria-label="共享网络地址" value={invite} onChange={setSelectedInvite} options={invitations.map(item => ({ value: item.invite, label: item.address }))} />}<Input.TextArea value={invite} readOnly autoSize={{ minRows: 2, maxRows: 4 }} /><Button icon={<Copy className="size-4" />} onClick={() => { copy(invite); message.success('邀请已复制'); }}>复制邀请</Button></div>}
                {!role && <div className="space-y-2"><Button type="primary" block disabled={!host || busy} loading={busy} onClick={() => void run(async () => { await host!(); message.success('协作房间已创建'); })}>共享当前画布</Button><div className="text-center text-xs" style={{ color: theme.node.muted }}>或粘贴房主邀请，新建协作副本</div><Input.TextArea aria-label="房间邀请" value={joinInvite} onChange={event => setJoinInvite(event.target.value)} placeholder="ONEYESCANVAS1..." autoSize={{ minRows: 2, maxRows: 4 }} /><Button block disabled={!join || !joinInvite.trim() || busy} loading={busy} onClick={() => void run(async () => { await join!(joinInvite.trim()); setOpen(false); message.success('正在加入协作房间，原画布已保留'); })}>加入房间</Button></div>}
                {role && <Space wrap><Button danger disabled={busy} icon={<LogOut className="size-4" />} onClick={() => void run(async () => { await leave?.(); message.info('已退出协作，本地副本已保留'); })}>{role === 'host' ? '结束协作' : '退出协作'}</Button>{syncing && <span className="text-xs motion-safe:animate-pulse" style={{ color: theme.node.muted }}>正在同步原始素材…</span>}</Space>}
                {error && <div className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: theme.collaboration[3], color: theme.node.text }}>{error}{retry && online && <Button type="link" size="small" onClick={retry}>重试同步</Button>}</div>}
                <div className="text-xs leading-5" style={{ color: theme.node.muted }}>每个人的光标、选中轮廓和节点操作标签使用对应颜色；点击成员可定位，视角各自独立。生成使用各自的账户和模型。房主退出后，已同步内容保留本机。</div>
                <details className="text-xs leading-5" style={{ color: theme.node.muted }}><summary className="cursor-pointer">同步范围与连接帮助</summary><p className="mt-2">共享节点、连线和引用原件；独立剪辑项目、账号、Key、聊天、视角及生成任务保留本机。断线每 3 秒重连，网络恢复或电脑唤醒后继续连接；重开加入的画布会自动恢复原房间，不重发生成。主动退出或房主结束协作后停止重连。无法连接时检查防火墙允许 Canvas 访问专用网络，并关闭路由器的设备隔离。邀请只发给信任的协作者。</p></details>
            </div>
        </Modal>
    </>;
}
