import { OTPField as O } from '@base-ui/react/otp-field';
import { cn } from '@/lib/utils';

/**
 * 一次性验证码输入（Base UI OTPField）。
 * - 位宽自适应容器，粘贴整段验证码可自动分配；
 * - `onComplete` 在填满时触发（用于自动提交）。
 */
export function OtpField({
  id,
  length = 6,
  value,
  onChange,
  onComplete,
  disabled,
  autoFocus,
  className,
}: {
  id?: string;
  length?: number;
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <O.Root
      id={id}
      length={length}
      value={value}
      onValueChange={onChange}
      onValueComplete={onComplete}
      validationType="numeric"
      disabled={disabled}
      className={cn('flex w-full gap-2', className)}
    >
      {Array.from({ length }, (_, i) => (
        <O.Input
          // biome-ignore lint/suspicious/noArrayIndexKey: OTP 输入框数量固定且不会重排，索引作 key 是安全的
          key={i}
          autoFocus={autoFocus && i === 0}
          aria-label={`验证码第 ${i + 1} 位`}
          className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-card text-center font-mono text-lg text-ink outline-none transition-colors focus:border-ai focus:ring-2 focus:ring-ai/25 disabled:opacity-50"
        />
      ))}
    </O.Root>
  );
}
