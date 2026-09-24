import { Button, Text, View } from "@tarojs/components";

export function EditorStateCard({
  action,
  detail,
  onAction,
  title,
}: {
  readonly action?: string | undefined;
  readonly detail?: string | undefined;
  readonly onAction?: (() => void) | undefined;
  readonly title: string;
}) {
  return (
    <View className="editor-state">
      <View className="editor-state__mark" aria-hidden />
      <Text className="editor-state__title">{title}</Text>
      {detail ? <Text className="editor-state__detail">{detail}</Text> : null}
      {action && onAction ? (
        <Button
          className="editor-button editor-button--secondary"
          onClick={onAction}
        >
          {action}
        </Button>
      ) : null}
    </View>
  );
}

export function EditorFieldLabel({ children }: { readonly children: string }) {
  return <Text className="editor-label">{children}</Text>;
}
