import type { Metadata, Viewport } from 'next'
import { Chivo, Inter, JetBrains_Mono } from 'next/font/google'
import { Toaster } from 'sonner'

import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--fuente-inter',
  display: 'swap',
})

const chivo = Chivo({
  subsets: ['latin'],
  weight: ['700'],
  variable: '--fuente-chivo',
  display: 'swap',
})

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--fuente-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Consola',
  description: 'Consola de operaciones de seguimiento de clientes',
}

export const viewport: Viewport = {
  themeColor: '#141a22',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className={`${inter.variable} ${chivo.variable} ${mono.variable}`}>
      <body>
        {children}
        <Toaster
          position="bottom-right"
          duration={2600}
          toastOptions={{
            style: {
              background: '#26313e',
              border: '1px solid #33404f',
              color: '#e6eaf0',
              borderRadius: '5px',
              fontSize: '12.5px',
            },
          }}
        />
      </body>
    </html>
  )
}
