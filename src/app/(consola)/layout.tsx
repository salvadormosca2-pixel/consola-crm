import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { Nav } from '@/components/nav'

export default async function LayoutConsola({ children }: { children: React.ReactNode }) {
  const sesion = await auth()
  if (!sesion?.user) redirect('/ingresar')

  return (
    <div className="min-h-dvh">
      <Nav usuario={sesion.user.name ?? sesion.user.email ?? ''} />
      <main className="mx-auto w-full max-w-[1800px] px-2 py-3 sm:px-3 sm:py-4">{children}</main>
    </div>
  )
}
