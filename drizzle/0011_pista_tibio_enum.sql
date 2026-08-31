-- El valor de enum va solo en su archivo: `ALTER TYPE ... ADD VALUE` no deja
-- usar el valor nuevo hasta que confirme la transacción que lo creó, y el
-- migrador confirma entre archivo y archivo.
--
-- 'tibio' es el que faltaba para el modelo de pistas: contestó la oferta, pero
-- ni que sí ni que no. Es una duda o una objeción —"cuánto sale", "después
-- veo"—, y es el lead que más se pierde por tratarlo como si fuera un no.

ALTER TYPE "lead_interes" ADD VALUE IF NOT EXISTS 'tibio';
