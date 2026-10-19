import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Home Energy',
  description: 'Your household energy, at a glance.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
