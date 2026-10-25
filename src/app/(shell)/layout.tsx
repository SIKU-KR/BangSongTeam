import { AppShellLayout } from "../../client/routes/AppShellLayout";

export default function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return <AppShellLayout>{children}</AppShellLayout>;
}
