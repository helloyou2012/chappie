import { ApiError, type Avatar, adminApi } from '@chappie/shared';
import { RiLoader4Line, RiLockLine, RiRobot2Line } from '@remixicon/react';
import { useEffect, useState } from 'react';
import { CapabilitiesTab } from '@/components/avatar/capabilities-tab';
import { MemoryTab } from '@/components/avatar/memory-tab';
import { PersonaTab } from '@/components/avatar/persona-tab';
import { PolicyTab } from '@/components/avatar/policy-tab';
import { UsageTab } from '@/components/avatar/usage-tab';
import { UserAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';

export function AvatarConsolePage() {
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [ready, setReady] = useState(false);
  const [freezing, setFreezing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      try {
        const res = await adminApi.getAvatar();
        if (!cancelled) {
          setAvatar(res.avatar);
          setReady(true);
        }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.isAvatarNotReady && attempts < 30) {
          attempts += 1;
          setTimeout(() => void tick(), 1200);
          return;
        }
        toast.error('加载分身失败', e instanceof Error ? e.message : String(e));
        setReady(true);
      }
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleFreeze = async () => {
    if (!avatar) return;
    setFreezing(true);
    try {
      const frozen = avatar.status !== 'frozen';
      await adminApi.freezeAvatar(frozen);
      setAvatar({ ...avatar, status: frozen ? 'frozen' : 'active' });
      toast.success(frozen ? '分身已冻结' : '分身已恢复', '冻结后分身不会代发任何消息');
    } catch (e) {
      toast.error('操作失败', e instanceof Error ? e.message : String(e));
    } finally {
      setFreezing(false);
    }
  };

  if (!ready) {
    return (
      <div className="flex-1 space-y-4 p-8">
        <Skeleton className="h-20 w-full rounded-md" />
        <Skeleton className="h-64 w-full rounded-md" />
      </div>
    );
  }

  return (
    <div className="scrollbar-thin flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <header className="mb-6 flex flex-wrap items-center gap-4">
          <UserAvatar
            name={avatar?.name ?? '分身'}
            variant="avatar"
            className="size-11 text-base"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[20px] font-semibold tracking-[-0.022em]">
                {avatar?.name ?? '我的分身'}
              </h1>
              {avatar?.status === 'frozen' ? (
                <Badge variant="destructive">已冻结</Badge>
              ) : (
                <Badge variant="success">运行中</Badge>
              )}
              {avatar?.selfConvId ? (
                <Badge variant="ai">
                  <RiRobot2Line className="size-2.5" /> 分身会话已就绪
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              代表你在会话中收发消息；所有行为可审计、可接管、可冻结。
            </p>
          </div>
          <Button
            variant={avatar?.status === 'frozen' ? 'default' : 'outline'}
            onClick={() => void toggleFreeze()}
            disabled={freezing || !avatar}
          >
            {freezing ? (
              <RiLoader4Line className="size-4 animate-spin" />
            ) : (
              <RiLockLine className="size-4" />
            )}
            {avatar?.status === 'frozen' ? '解冻分身' : '紧急冻结'}
          </Button>
        </header>

        <Tabs defaultValue="persona">
          <TabsList>
            <TabsTrigger value="persona">人设</TabsTrigger>
            <TabsTrigger value="policy">策略</TabsTrigger>
            <TabsTrigger value="capabilities">能力</TabsTrigger>
            <TabsTrigger value="memory">记忆</TabsTrigger>
            <TabsTrigger value="usage">用量</TabsTrigger>
          </TabsList>
          <TabsContent value="persona">
            {avatar ? <PersonaTab avatar={avatar} onSaved={setAvatar} /> : null}
          </TabsContent>
          <TabsContent value="policy">
            <PolicyTab />
          </TabsContent>
          <TabsContent value="capabilities">
            <CapabilitiesTab />
          </TabsContent>
          <TabsContent value="memory">
            <MemoryTab />
          </TabsContent>
          <TabsContent value="usage">
            <UsageTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
