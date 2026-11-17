/**
 * 移动端设计系统入口 —— 页面一律从这里取组件，不直接写裸 View/Text 样式。
 *
 * 原语：Text / Screen / PageHeader / Card / Divider / Button / IconButton /
 *       Field / Input / Badge / SegmentedControl / Chip / ChipRow /
 *       BottomSheet / Dialog / MenuRow / ListRow / EmptyState / Avatar / Spinner
 */
export { Avatar } from './avatar';
export { Badge, type BadgeTone } from './badge';
export { Button, type ButtonSize, type ButtonVariant, IconButton } from './button';
export { EmptyState } from './empty-state';
export { Field, Input } from './input';
export { ListRow } from './list-row';
export { Chip, ChipRow, type Option, SegmentedControl } from './segmented';
export { BottomSheet, Dialog, MenuRow } from './sheet';
export { Spinner } from './spinner';
export { Card, Divider, PageHeader, Screen, space } from './surface';
export { Text, type TextTone, type TextVariant } from './text';
export { Toggle } from './toggle';
