/* ── El estado nuevo, solo ──────────────────────────────────────────────
   'calificado' es el único estado que suma el modelo nuevo: el lead contestó,
   alguien lo miró y decidió que vale la pena seguirlo. Es lo que reemplaza a
   las tres clasificaciones de la oferta (le interesa / tibio / no le interesa)
   y a las dos escaleras que salían de ellas.

   Va solo en su archivo porque `ALTER TYPE ... ADD VALUE` no deja usar el
   valor nuevo hasta que la transacción que lo creó haya confirmado, y el
   migrador corre un archivo por transacción. Separado, la migración que sigue
   puede escribirlo. */

ALTER TYPE "lead_assignment_estado" ADD VALUE IF NOT EXISTS 'calificado' AFTER 'contactado';
