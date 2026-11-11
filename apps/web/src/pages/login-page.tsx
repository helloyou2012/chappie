import { ApiError, useAuthStore } from '@chappie/shared';
import { SparklesIcon } from '@heroicons/react/24/outline';
import { RiArrowLeftSLine, RiLoader4Line, RiMailLine, RiSettings3Line } from '@remixicon/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Logo } from '@/components/ui/logo';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

type Step = 'email' | 'code';

export function LoginPage() {
  const navigate = useNavigate();
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const adminUrl = useAuthStore((s) => s.adminUrl);
  const setServerUrl = useAuthStore((s) => s.setServerUrl);
  const sendCode = useAuthStore((s) => s.sendCode);
  const login = useAuthStore((s) => s.login);

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showServer, setShowServer] = useState(false);
  const [serverDraft, setServerDraft] = useState(serverUrl);
  const [adminDraft, setAdminDraft] = useState(adminUrl);

  const sendCodeNow = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await sendCode(email.trim());
      setDevCode(res.devCode);
      setStep('code');
      if (res.devCode) {
        toast.success('开发模式验证码已回显', '已自动填入验证码框');
        setCode(res.devCode);
      } else {
        toast.success('验证码已发送', '请查收邮箱');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setBusy(false);
    }
  };

  const onSendCode = (e: React.FormEvent) => {
    e.preventDefault();
    void sendCodeNow();
  };

  const onVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), code.trim());
      navigate('/chat', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  const saveServer = async () => {
    await setServerUrl(serverDraft, adminDraft);
    toast.success('服务器地址已保存');
    setShowServer(false);
  };

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-canvas px-4">
      {/* 极弱顶部光晕（不抢内容） */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(50%_50%,var(--brand-soft)_0%,transparent_90%)] opacity-70"
      />

      <div className="relative w-full max-w-[360px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 items-center justify-center">
            <Logo className="h-12 w-auto" />
          </div>
          <h1 className="text-[22px] font-semibold tracking-[-0.022em] text-ink">Chappie</h1>
          <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-ink-tertiary">
            <SparklesIcon className="size-3.5 text-brand" />
            你的 AI 分身，替你在线
          </p>
        </div>

        <div className="glass card-edge rounded-xl border border-line p-6">
          {step === 'email' ? (
            <form onSubmit={onSendCode} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="login-email" className="text-[12px] font-medium text-ink-secondary">
                  邮箱
                </label>
                <div className="relative">
                  <RiMailLine className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-quaternary" />
                  <Input
                    id="login-email"
                    autoFocus
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="h-9 pl-8"
                    required
                  />
                </div>
                <p className="text-[11px] text-ink-tertiary">首次登录将自动创建账号与分身。</p>
              </div>
              {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={busy || !email.trim()}>
                {busy ? <RiLoader4Line className="size-4 animate-spin" /> : '获取验证码'}
              </Button>
            </form>
          ) : (
            <form onSubmit={onVerify} className="space-y-4">
              <button
                type="button"
                onClick={() => {
                  setStep('email');
                  setError(null);
                }}
                className="flex items-center gap-1 text-[11px] text-ink-tertiary transition-colors hover:text-ink"
              >
                <RiArrowLeftSLine className="size-3" /> 更换邮箱
              </button>
              <div className="space-y-1.5">
                <label htmlFor="login-code" className="text-[12px] font-medium text-ink-secondary">
                  验证码
                </label>
                <Input
                  id="login-code"
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6 位数字验证码"
                  className={cn('h-9 text-center text-base tracking-[0.5em]')}
                  inputMode="numeric"
                  maxLength={6}
                  required
                />
                <p className="text-[11px] text-ink-tertiary">
                  已发送至 <span className="text-ink-secondary">{email}</span>
                  {devCode ? '（开发模式已回显）' : ''}
                </p>
              </div>
              {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={busy || code.length < 4}>
                {busy ? <RiLoader4Line className="size-4 animate-spin" /> : '登录'}
              </Button>
              <button
                type="button"
                className="w-full text-center text-[11px] text-ink-tertiary transition-colors hover:text-ink disabled:opacity-50"
                disabled={busy}
                onClick={() => void sendCodeNow()}
              >
                重新发送验证码
              </button>
            </form>
          )}
        </div>

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => setShowServer((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] text-ink-tertiary transition-colors hover:text-ink"
          >
            <RiSettings3Line className="size-3" /> 服务器设置
          </button>
          {showServer ? (
            <div className="glass mt-3 space-y-2 rounded-xl border border-line p-3 text-left">
              <div className="space-y-1">
                <label htmlFor="server-url" className="text-[11px] text-ink-tertiary">
                  网关地址
                </label>
                <Input
                  id="server-url"
                  value={serverDraft}
                  onChange={(e) => setServerDraft(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="admin-url" className="text-[11px] text-ink-tertiary">
                  控制台地址
                </label>
                <Input
                  id="admin-url"
                  value={adminDraft}
                  onChange={(e) => setAdminDraft(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <Button size="sm" className="w-full" onClick={() => void saveServer()}>
                保存
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
