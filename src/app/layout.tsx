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
  title: '101leads',
  description: '101leads — captación y seguimiento de clientes por Instagram',
}

export const viewport: Viewport = {
  themeColor: '#02100D',
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
              background: '#062018',
              border: '1px solid #12312A',
              color: '#EAF6F2',
              borderRadius: '8px',
              fontSize: '13px',
            },
          }}
        />
      </body>
    </html>
  )
}
