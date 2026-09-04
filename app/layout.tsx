import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Dialog Index', description: 'A WebMCP-native personal data store for humans and agents.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
