-- ============================================================
-- MetaCrypto OS — seed de DESARROLLO LOCAL (docs/08 §1.2)
-- Datos inventados (nada de clientes reales). Corre con `supabase db reset`
-- y tras cada reset deja la base lista para entrar y probar.
-- Idempotente: IDs fijos + `on conflict do nothing` → se puede re-ejecutar.
-- ============================================================

-- ── 0) Login de desarrollo ───────────────────────────────────────────────────
-- Las migraciones NO crean al equipo con login (los setters de la 0029 nacen
-- sin username): esos usuarios venían de datos del proyecto de producción.
-- Sin esto, tras un `db reset` no se puede entrar al OS.
-- Password para TODOS en local: dev1234 (hash scrypt, formato de
-- apps/inbox/lib/auth.ts). Solo desarrollo — nunca reproducir esto con
-- credenciales reales.
insert into public.team_members (id, nombre, rol, username, password_hash, acceso_total, activo, created_at) values
  ('f0000000-0000-4000-8000-000000000001', 'Berni',  'coach',  'berni',  'scrypt$4550f97d5969952f3b3216c3a7ce1208$591c09fd28c52d36835305a0983ef78df747ade3fe5be8f1fcd613c085cc9fcaa7e648e1cc8124283b8472131b14eb420ef2b28472f03e5bb824292cb53325d1', true,  true, now() - interval '400 days'),
  ('f0000000-0000-4000-8000-000000000002', 'Milo',   'admin',  'milo',   'scrypt$4550f97d5969952f3b3216c3a7ce1208$591c09fd28c52d36835305a0983ef78df747ade3fe5be8f1fcd613c085cc9fcaa7e648e1cc8124283b8472131b14eb420ef2b28472f03e5bb824292cb53325d1', true,  true, now() - interval '400 days'),
  ('f0000000-0000-4000-8000-000000000003', 'Alex',   'coach',  'alex',   'scrypt$4550f97d5969952f3b3216c3a7ce1208$591c09fd28c52d36835305a0983ef78df747ade3fe5be8f1fcd613c085cc9fcaa7e648e1cc8124283b8472131b14eb420ef2b28472f03e5bb824292cb53325d1', true,  true, now() - interval '400 days'),
  ('f0000000-0000-4000-8000-000000000004', 'Manuel', 'coach',  'manuel', 'scrypt$4550f97d5969952f3b3216c3a7ce1208$591c09fd28c52d36835305a0983ef78df747ade3fe5be8f1fcd613c085cc9fcaa7e648e1cc8124283b8472131b14eb420ef2b28472f03e5bb824292cb53325d1', false, true, now() - interval '400 days'),
  ('f0000000-0000-4000-8000-000000000005', 'Paula',  'setter', 'paula',  'scrypt$4550f97d5969952f3b3216c3a7ce1208$591c09fd28c52d36835305a0983ef78df747ade3fe5be8f1fcd613c085cc9fcaa7e648e1cc8124283b8472131b14eb420ef2b28472f03e5bb824292cb53325d1', false, true, now() - interval '400 days')
on conflict (id) do nothing;

-- Por si el usuario ya existía (volumen previo): asegura el password de dev.
update public.team_members
  set password_hash = 'scrypt$4550f97d5969952f3b3216c3a7ce1208$591c09fd28c52d36835305a0983ef78df747ade3fe5be8f1fcd613c085cc9fcaa7e648e1cc8124283b8472131b14eb420ef2b28472f03e5bb824292cb53325d1'
  where username in ('berni', 'milo', 'alex', 'manuel', 'paula');

-- Sesiones grupales recurrentes (la 0053 no inserta nada si los coaches no
-- existen todavía — en el reset fresco es el caso; aquí están, se crean).
insert into public.sesiones_recurrentes (dia_semana, coach_id)
select v.dia_semana, v.coach_id
from (values
  (3, 'f0000000-0000-4000-8000-000000000004'::uuid), -- miércoles con Manuel
  (0, 'f0000000-0000-4000-8000-000000000001'::uuid)  -- domingo con Berni
) as v(dia_semana, coach_id)
where exists (select 1 from public.team_members m where m.id = v.coach_id)
  and not exists (
    select 1 from public.sesiones_recurrentes r
    where r.dia_semana = v.dia_semana and r.coach_id = v.coach_id
  );

-- ── 1) Personas (mix de estados para ver todos los filtros) ──────────────────
insert into public.personas (id, estado, nombre, telefono_e164, email, pais, coach_id, divisa_preferida, created_at) values
  ('a0000000-0000-4000-8000-000000000001', 'cliente',    'Carlos Giménez',  '+34600000001', 'carlos.gimenez@test.local',  'España',    (select id from public.team_members where username = 'berni'), 'EUR', now() - interval '75 days'),
  ('a0000000-0000-4000-8000-000000000002', 'cliente',    'Laura Fernández', '+54911000002', 'laura.fernandez@test.local', 'Argentina', (select id from public.team_members where username = 'alex'),  'USD', now() - interval '25 days'),
  ('a0000000-0000-4000-8000-000000000003', 'cliente',    'Sofía Cabrera',   '+54911000003', 'sofia.cabrera@test.local',   'Argentina', (select id from public.team_members where username = 'berni'), 'EUR', now() - interval '210 days'),
  ('a0000000-0000-4000-8000-000000000004', 'ex_cliente', 'Diego Torres',    '+34600000004', 'diego.torres@test.local',    'España',    (select id from public.team_members where username = 'alex'),  'EUR', now() - interval '400 days'),
  ('a0000000-0000-4000-8000-000000000005', 'reservado',  'Martín Sosa',     '+59890000005', 'martin.sosa@test.local',     'Uruguay',   (select id from public.team_members where username = 'berni'), 'USD', now() - interval '9 days'),
  ('a0000000-0000-4000-8000-000000000006', 'lead',       'Ana Ruiz',        '+56910000006', 'ana.ruiz@test.local',        'Chile',     (select id from public.team_members where username = 'berni'), 'USD', now() - interval '2 days')
on conflict (id) do nothing;

-- ── 2) Programas (ventas activas + una cerrada del ex-cliente) ───────────────
insert into public.programas (id, persona_id, tier, motivo, fecha_inicio, meses_duracion, monto, divisa, setter_id, closer_id, atribucion_at, created_at) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '3000', 'nueva_venta', current_date - 70, 8,  3000, 'EUR', (select id from public.team_members where username = 'paula'), (select id from public.team_members where username = 'alex'), now() - interval '70 days', now() - interval '70 days'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', '5000', 'nueva_venta', current_date - 20, 12, 5000, 'USD', (select id from public.team_members where username = 'dani'),  (select id from public.team_members where username = 'manuel'), null, now() - interval '20 days'),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003', '1800', 'nueva_venta', current_date - 200, 6, 1800, 'EUR', (select id from public.team_members where username = 'juan'),  (select id from public.team_members where username = 'alex'), now() - interval '200 days', now() - interval '200 days'),
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000004', '1800', 'nueva_venta', current_date - 395, 6, 1800, 'EUR', (select id from public.team_members where username = 'paula'), (select id from public.team_members where username = 'alex'), now() - interval '395 days', now() - interval '395 days')
on conflict (id) do nothing;

-- ── 3) Cuotas programadas ────────────────────────────────────────────────────
-- Carlos (€3.000): 600 de reserva + 6 cuotas de 400. Dos pagadas, una
-- vencida (para probar el módulo de cobranza) y tres pendientes.
insert into public.cuotas_programadas (id, programa_id, numero_cuota, fecha_vencimiento, monto, divisa, estado) values
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 1, current_date - 70, 600, 'EUR', 'pagada'),
  ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 2, current_date - 40, 400, 'EUR', 'pagada'),
  ('c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001', 3, current_date - 10, 400, 'EUR', 'vencida'),
  ('c0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001', 4, current_date + 20, 400, 'EUR', 'pendiente'),
  ('c0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000001', 5, current_date + 50, 400, 'EUR', 'pendiente'),
  ('c0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000001', 6, current_date + 80, 400, 'EUR', 'pendiente'),
  ('c0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000001', 7, current_date + 110, 400, 'EUR', 'pendiente'),
  -- Laura (US$5.000): reserva 500 pagada + resto pendiente
  ('c0000000-0000-4000-8000-000000000008', 'b0000000-0000-4000-8000-000000000002', 1, current_date - 20, 500, 'USD', 'pagada'),
  ('c0000000-0000-4000-8000-000000000009', 'b0000000-0000-4000-8000-000000000002', 2, current_date + 10, 500, 'USD', 'pendiente'),
  ('c0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-000000000002', 3, current_date + 40, 500, 'USD', 'pendiente')
on conflict (id) do nothing;

-- ── 4) Pagos (respaldan las cuotas pagadas + el refund del ex-cliente) ───────
insert into public.pagos (id, persona_id, cuota_id, programa_id, tipo, monto, divisa, fecha, metodo_pago, created_at, devolucion_alcance, devolucion_motivo) values
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'reserva', 600, 'EUR', current_date - 70, 'transferencia', now() - interval '70 days', null, null),
  ('d0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'cuota',   400, 'EUR', current_date - 40, 'tarjeta',       now() - interval '40 days', null, null),
  ('d0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000008', 'b0000000-0000-4000-8000-000000000002', 'reserva', 500, 'USD', current_date - 20, 'cripto',        now() - interval '20 days', null, null),
  -- Diego pidió el dinero de vuelta: refund total de su única cuota pagada.
  -- El CHECK exige devolucion_alcance NO NULL en la MISMA fila: se inserta con
  -- la marca puesta, no con un UPDATE posterior.
  ('d0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000004', null, 'b0000000-0000-4000-8000-000000000004', 'refund', 1800, 'EUR', current_date - 150, null, now() - interval '150 days', 'total', 'Datos de prueba: refund de ejemplo')
on conflict (id) do nothing;

-- ── 5) Sesiones (consultorías: una hecha, una agendada) ──────────────────────
insert into public.sesiones (id, persona_id, programa_id, tipo, coach_id, fecha, notas, estado, capital_total, exchange, proximo_paso) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'consultoria_1a1', (select id from public.team_members where username = 'berni'), now() - interval '30 days',  'Datos de prueba: revisión de portfolio inicial, demasiado USDT ocioso.', 'realizada', 45000, 'Binance', 'DCA semanal y salir de la stable a rendimiento'),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'consultoria_1a1', (select id from public.team_members where username = 'alex'),  now() + interval '5 days',  'Datos de prueba: primera consultoría, definir tolerancia al riesgo.',    'agendada',  null,     null,      null)
on conflict (id) do nothing;

-- ── 6) Atribución de fuentes (para probar el módulo) ─────────────────────────
insert into public.fuentes_atribucion (source_id, fuente, nivel, confirmado) values
  ('test-src-001', 'Instagram DM (Paula)',  'setter',    true),
  ('test-src-002', 'Reels orgánicos',       'contenido', true),
  ('test-src-003', 'Referido de cliente',   'canal',     false)
on conflict (source_id) do nothing;

update public.programas set source_id = 'test-src-001'
  where id = 'b0000000-0000-4000-8000-000000000001';
update public.programas set source_id = 'test-src-002', ghl_appointment_id = 'test-ghl-appt-002'
  where id = 'b0000000-0000-4000-8000-000000000003';

-- ============================================================
-- 7) Contratos + sus eventos. Uno firmado (Carlos) y uno enviado al
--    cliente (Laura): cubre los dos estados que pinta la pantalla.
-- ============================================================
insert into public.contratos (id, persona_id, programa_id, tipo, estado, fecha_firma, url_documento, token, enviado_cliente_at, visto_at, firmado_at, firma_nombre, firma_ip, created_at, datos_bloque) values
  ('11000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'venta_nueva_v2', 'firmado', current_date - 69, 'https://test.local/contratos/carlos.pdf', 'test-token-contrato-carlos', now() - interval '70 days', now() - interval '69 days 12 hours', now() - interval '69 days', 'Carlos Giménez', '203.0.113.10', now() - interval '70 days', '{"nombre": "Carlos Giménez", "tier": "3000"}'::jsonb),
  ('11000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'venta_nueva_v2', 'enviado_cliente', null, 'https://test.local/contratos/laura.pdf', 'test-token-contrato-laura', now() - interval '19 days', now() - interval '19 days 6 hours', null, null, null, now() - interval '20 days', '{"nombre": "Laura Fernández", "tier": "5000"}'::jsonb)
on conflict (id) do nothing;

insert into public.contrato_eventos (id, contrato_id, tipo, ocurrido_at, ip, user_agent, datos) values
  ('12000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'enviado',  now() - interval '70 days', null, null, '{}'::jsonb),
  ('12000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000001', 'abierto',  now() - interval '69 days 12 hours', '203.0.113.10'::inet, 'test-agent', '{}'::jsonb),
  ('12000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000001', 'firmado',  now() - interval '69 days', '203.0.113.10'::inet, 'test-agent', '{}'::jsonb),
  ('12000000-0000-4000-8000-000000000004', '11000000-0000-4000-8000-000000000002', 'enviado',  now() - interval '19 days', null, null, '{}'::jsonb),
  ('12000000-0000-4000-8000-000000000005', '11000000-0000-4000-8000-000000000002', 'abierto',  now() - interval '19 days 6 hours', '198.51.100.20'::inet, 'test-agent', '{}'::jsonb)
on conflict (id) do nothing;

-- ============================================================
-- 8) Estrategias (documentos que ve el cliente), gastos, auditoría.
-- ============================================================
insert into public.estrategias (id, persona_id, titulo, url, fecha_lanzamiento, visible, created_at) values
  ('13000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'Plan de despliegue de capital — Fase 1', 'https://test.local/estrategias/carlos-1', current_date - 25, true, now() - interval '25 days'),
  ('13000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'Estrategia de entrada por DCA',           'https://test.local/estrategias/laura-1',  current_date - 10, true, now() - interval '10 days')
on conflict (id) do nothing;

insert into public.gastos (id, concepto, categoria, monto, divisa, fecha, tipo_gasto, metodo_pago, created_at) values
  ('14000000-0000-4000-8000-000000000001', 'Sueldo Paula (datos de prueba)',  'personal',     3000, 'EUR', date_trunc('month', current_date)::date, 'fijo', 'transferencia', now() - interval '20 days'),
  ('14000000-0000-4000-8000-000000000002', 'Suscripción herramientas',        'herramientas',  250, 'EUR', current_date - 15, 'fijo', 'tarjeta', now() - interval '15 days'),
  ('14000000-0000-4000-8000-000000000003', 'Publicidad Instagram (test)',     'marketing',     400, 'EUR', current_date - 5,  'variable', 'tarjeta', now() - interval '5 days')
on conflict (id) do nothing;

insert into public.auditoria (id, entidad, entidad_id, accion, autor_id, datos, created_at) values
  ('15000000-0000-4000-8000-000000000001', 'cuota', 'c0000000-0000-4000-8000-000000000002', 'pago_registrado', (select id from public.team_members where username = 'milo'), '{"monto": 400}'::jsonb, now() - interval '40 days'),
  ('15000000-0000-4000-8000-000000000002', 'programa', 'b0000000-0000-4000-8000-000000000002', 'creado', (select id from public.team_members where username = 'manuel'), '{"tier": "5000"}'::jsonb, now() - interval '20 days'),
  ('15000000-0000-4000-8000-000000000003', 'devolucion', 'd0000000-0000-4000-8000-000000000005', 'refund_registrado', (select id from public.team_members where username = 'milo'), '{"alcance": "total"}'::jsonb, now() - interval '150 days')
on conflict (id) do nothing;

-- ============================================================
-- 9) Onboarding, accesos al portal y patrimonio del cliente.
-- ============================================================
insert into public.onboarding (id, persona_id, accesos, bienvenida_enviada, created_at) values
  ('16000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '{"discord": true, "comunidad": true}'::jsonb, true,  now() - interval '69 days'),
  ('16000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', '{"discord": true, "comunidad": false}'::jsonb, false, now() - interval '19 days')
on conflict (id) do nothing;

insert into public.portal_accesos (id, persona_id, token, created_at) values
  ('17000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'test-token-portal-carlos', now() - interval '69 days'),
  ('17000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'test-token-portal-laura',  now() - interval '19 days')
on conflict (id) do nothing;

insert into public.patrimonio_snapshots (id, persona_id, valor_total, divisa, fecha, created_at) values
  ('18000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 45000, 'USD', current_date - 30, now() - interval '30 days'),
  ('18000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 47200, 'USD', current_date - 7,  now() - interval '7 days'),
  ('18000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', 12000, 'USD', current_date - 7,  now() - interval '7 days')
on conflict (id) do nothing;

insert into public.posiciones (id, persona_id, activo, cantidad, precio_entrada, fecha, created_at) values
  ('19000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'BTC',  0.45,     61000, current_date - 60, now() - interval '60 days'),
  ('19000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'ETH',  6.2,      3300,  current_date - 55, now() - interval '55 days'),
  ('19000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', 'BTC',  0.12,     64000, current_date - 18, now() - interval '18 days')
on conflict (id) do nothing;

-- ============================================================
-- 10) Evento de programa congelado (la CHECK solo admite 'freeze').
-- ============================================================
insert into public.programa_eventos (id, programa_id, tipo, fecha_inicio, fecha_fin, created_at) values
  ('1a000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000004', 'freeze', current_date - 160, current_date - 150, now() - interval '160 days')
on conflict (id) do nothing;

-- ============================================================
-- 11) Operaciones registradas en la consultoría de Carlos.
-- ============================================================
insert into public.sesion_operaciones (id, sesion_id, orden, direccion, activo, capital, apalancamiento, zona_entrada, objetivo, estado, created_at) values
  ('1b000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 1, 'long', 'BTC', 15000, '2x', '60000-61500', '68000', 'ejecutada', now() - interval '30 days'),
  ('1b000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001', 2, 'spot', 'ETH', 8000,  null, null,          null,    'planificada', now() - interval '30 days')
on conflict (id) do nothing;

-- ============================================================
-- 12) WhatsApp: conversaciones y mensajes (inbox).
-- ============================================================
insert into public.wa_conversaciones (id, telefono_e164, estado, estado_atencion, coach_asignado, created_at) values
  ('1c000000-0000-4000-8000-000000000001', '+34600000001', 'active', 'pendiente', (select id from public.team_members where username = 'berni'), now() - interval '3 days'),
  ('1c000000-0000-4000-8000-000000000002', '+54911000002', 'active', 'resuelto',  (select id from public.team_members where username = 'alex'),  now() - interval '10 days')
on conflict (id) do nothing;

insert into public.wa_mensajes (id, conversacion_id, direction, body, autor, status, sent_at, created_at) values
  ('1d000000-0000-4000-8000-000000000001', '1c000000-0000-4000-8000-000000000001', 'in',  'Hola, ¿cuándo es la próxima consultoría?', 'Carlos Giménez', 'delivered', now() - interval '3 days',  now() - interval '3 days'),
  ('1d000000-0000-4000-8000-000000000002', '1c000000-0000-4000-8000-000000000001', 'out', 'Hola Carlos, te agendo el miércoles a las 18h.', 'Berni', 'delivered', now() - interval '3 days + 2 hours', now() - interval '3 days + 2 hours'),
  ('1d000000-0000-4000-8000-000000000003', '1c000000-0000-4000-8000-000000000002', 'in',  'Perfecto, gracias!', 'Laura Fernández', 'delivered', now() - interval '10 days', now() - interval '10 days')
on conflict (id) do nothing;

-- ============================================================
-- 13) Emails del sistema y Fathom (llamadas grabadas).
-- ============================================================
insert into public.emails_enviados (id, persona_id, sesion_id, tipo, destinatario, idempotency_key, estado, created_at) values
  ('1e000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'confirmacion_sesion', 'carlos.gimenez@test.local', 'test-email-001', 'entregado', now() - interval '31 days'),
  ('1e000000-0000-4000-8000-000000000002', null, null, 'aviso_venta_equipo', 'equipo@metacrypto.test', 'test-email-002', 'enviado', now() - interval '20 days')
on conflict (id) do nothing;

insert into public.fathom_llamadas (id, recording_id, titulo, grabado_por_email, grabado_por_nombre, grabado_por_equipo, inicio, fin, duracion_min, tipo, persona_id, emparejado_por, creado_at) values
  ('1f000000-0000-4000-8000-000000000001', 900001, 'Consultoría Carlos Giménez (test)', 'berni@test.local', 'Berni', 'metacrypto', now() - interval '30 days', now() - interval '30 days' + interval '55 minutes', 55, 'servicio', 'a0000000-0000-4000-8000-000000000001', 'correo', now() - interval '30 days'),
  ('1f000000-0000-4000-8000-000000000002', 900002, 'Venta Laura Fernández (test)',      'manuel@test.local', 'Manuel', 'metacrypto', now() - interval '21 days', now() - interval '21 days' + interval '40 minutes', 40, 'venta', 'a0000000-0000-4000-8000-000000000002', 'titulo', now() - interval '21 days')
on conflict (id) do nothing;

-- ============================================================
-- 14) Push: suscripciones de dispositivos y avisos enviados.
-- ============================================================
insert into public.push_suscripciones (id, team_member_id, endpoint, p256dh, auth, creada_at) values
  ('20000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002', 'https://push.test.local/endpoint-milo',  'test-p256dh-milo',  'test-auth-milo',  now() - interval '60 days'),
  ('20000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'https://push.test.local/endpoint-berni', 'test-p256dh-berni', 'test-auth-berni', now() - interval '60 days')
on conflict (id) do nothing;

insert into public.push_enviados (mensaje_id, team_member_id, enviado_at) values
  -- mensaje_id referencia a wa_mensajes: el push avisa de un mensaje nuevo.
  ('1d000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002', now() - interval '20 days'),
  ('1d000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000001', now() - interval '3 days')
on conflict do nothing;

-- ============================================================
-- 15) Leads del Quiz Funnel (docs/11): envíos en todos los estados para
--     probar el módulo /leads. El quiz_version_id se resuelve por codigo.
--     Los leads temporales de personas nacen por el RPC; acá los insertamos
--     a mano con el MISMO invariant: telefono_e164 NULL en personas, el
--     teléfono real vive en el snapshot del envío.
-- ============================================================
insert into public.personas (id, estado, nombre, email, pais, telefono_e164, divisa_preferida) values
  ('a0000000-0000-4000-8000-000000000011', 'lead',      'Nicolás Ferrari', 'lead.caliente@test.local', 'AR', null, 'USD'),
  ('a0000000-0000-4000-8000-000000000012', 'lead',      'Valeria Ortiz',   'lead.frio@test.local',     'CL', null, 'USD'),
  ('a0000000-0000-4000-8000-000000000013', 'cliente',   'Martín Ávalos',   'lead.convertido@test.local','AR', '+5493585000999', 'USD')
on conflict (id) do nothing;

insert into public.programas (id, persona_id, tier, motivo, fecha_inicio, meses_duracion, monto, divisa) values
  ('b0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000013', '3000', 'nueva_venta', current_date - 5, 8, 3000, 'EUR')
on conflict (id) do nothing;

insert into public.diagnostico_envios
  (id, session_id, quiz_version_id, persona_id, schema_version, estado,
   nombre_capturado, email_capturado, telefono_e164_capturado, pais_capturado,
   consentimiento_aceptado, consentimiento_version, consentimiento_at,
   started_at, finished_at, last_step_id, last_step_index,
   utm_source, utm_medium, utm_campaign,
   capital_min_usd, capital_max_usd, es_lead_caliente, qualification_rule_version, motivo_calificacion,
   diagnosis_version, diagnosis_result, dropped_at)
values
  -- lead caliente completado (sin vincular)
  ('b1000000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000001',
   (select id from public.quiz_versiones where codigo = 'diagnostico-cripto-v1-a'),
   'a0000000-0000-4000-8000-000000000011', 1, 'completed',
   'Nicolás Ferrari', 'lead.caliente@test.local', '+5493585000101', 'AR',
   true, 'contacto-v1', now() - interval '2 days',
   now() - interval '2 days - 12 minutes', now() - interval '2 days' + interval '6 minutes', 'result', 10,
   'instagram', 'organic', 'diagnostico-septiembre',
   100000, 250000, true, 'hot-lead-v1', 'hot-lead-v1: capital_100k_250k (capital >= 10000 USD)',
   'diagnostico-v1', '{"hot": true, "sections": [{"title": "Tu situación real"}, {"title": "El desajuste principal"}, {"title": "La señal que no conviene ignorar"}, {"title": "Tu plan de acción"}]}'::jsonb, null),
  -- lead frío completado
  ('b1000000-0000-4000-8000-000000000002', '0d000000-0000-4000-8000-000000000002',
   (select id from public.quiz_versiones where codigo = 'diagnostico-cripto-v1-a'),
   'a0000000-0000-4000-8000-000000000012', 1, 'completed',
   'Valeria Ortiz', 'lead.frio@test.local', '+56910000102', 'CL',
   true, 'contacto-v1', now() - interval '6 days',
   now() - interval '6 days', now() - interval '6 days' + interval '9 minutes', 'result', 10,
   null, null, null,
   5000, 10000, false, 'hot-lead-v1', 'hot-lead-v1: capital_lt_10k (capital < 10000 USD)',
   'diagnostico-v1', '{"hot": false, "sections": []}'::jsonb, null),
  -- lead ya vinculado a un cliente (para ver el estado "convertido")
  ('b1000000-0000-4000-8000-000000000003', '0d000000-0000-4000-8000-000000000003',
   (select id from public.quiz_versiones where codigo = 'diagnostico-cripto-v1-a'),
   'a0000000-0000-4000-8000-000000000013', 1, 'completed',
   'Martín Ávalos', 'lead.convertido@test.local', '+5493585000999', 'AR',
   true, 'contacto-v1', now() - interval '30 days',
   now() - interval '30 days', now() - interval '30 days' + interval '5 minutes', 'result', 10,
   'instagram', 'organic', 'diagnostico-septiembre',
   25000, 50000, true, 'hot-lead-v1', 'hot-lead-v1: capital_25k_50k (capital >= 10000 USD)',
   'diagnostico-v1', '{"hot": true, "sections": []}'::jsonb, null),
  -- abandono en portfolio (sin contacto, sin persona)
  ('b1000000-0000-4000-8000-000000000004', '0d000000-0000-4000-8000-000000000004',
   (select id from public.quiz_versiones where codigo = 'diagnostico-cripto-v1-a'),
   null, 1, 'dropped',
   null, null, null, null,
   null, null, null,
   now() - interval '1 day', null, 'allocation', 3,
   'instagram', 'organic', 'diagnostico-septiembre',
   null, null, null, null, null,
   null, null,
   -- dropped_at: la CHECK exige fecha cuando estado=dropped
   now() - interval '1 day')
on conflict (id) do nothing;

-- Respuestas de ejemplo para el lead caliente (el módulo renderiza desde
-- snapshots: cualquier pregunta sirve, con sus IDs estables).
insert into public.diagnostico_respuestas
  (envio_id, question_id, question_type, question_text, question_order, answer_id, answer_text, answer_value, answered_at)
values
  ('b1000000-0000-4000-8000-000000000001', 'situation', 'single_choice', '¿Qué describe mejor tu situación actual con las criptomonedas?', 1, 'exposure_full_unclear', 'Estoy 100% expuesto, pero no tengo claro si mi portfolio está bien', null, now() - interval '2 days - 11 minutes'),
  ('b1000000-0000-4000-8000-000000000001', 'challenge', 'single_choice', '¿Qué es lo que más te cuesta ahora mismo?', 2, 'pain_risk', 'Gestionar el riesgo', null, now() - interval '2 days - 10 minutes'),
  ('b1000000-0000-4000-8000-000000000001', 'allocation', 'allocation', '¿Cómo se distribuye tu portfolio hoy?', 3, null, 'BTC: 50-75% · ETH: 1-10%', '[{"asset_id":"btc","level":"high"},{"asset_id":"eth","level":"minimal"},{"asset_id":"alts","level":"zero"},{"asset_id":"stables","level":"zero"}]'::jsonb, now() - interval '2 days - 9 minutes'),
  ('b1000000-0000-4000-8000-000000000001', 'capital', 'range', '¿Con qué cantidad de capital estás trabajando actualmente o tienes previsto destinar a cripto durante este ciclo?', 4, 'capital_100k_250k', 'Entre 100.000 y 250.000 USD', '{"currency":"USD","min":100000,"max":250000,"min_inclusive":true,"max_inclusive":false}'::jsonb, now() - interval '2 days - 8 minutes'),
  ('b1000000-0000-4000-8000-000000000001', 'horizon', 'single_choice', '¿Cuál es tu horizonte de tiempo con estas inversiones?', 5, 'horizon_cycle_3y', 'El ciclo cripto completo (3 años aprox.)', null, now() - interval '2 days - 7 minutes'),
  ('b1000000-0000-4000-8000-000000000001', 'drawdown', 'single_choice', 'Imagina que mañana hay una noticia negativa y tu portfolio ha caído un 30%. ¿Qué harías?', 6, 'drawdown_hold', 'Mantengo, no toco nada', null, now() - interval '2 days - 6 minutes'),
  ('b1000000-0000-4000-8000-000000000001', 'influence', 'single_choice', '¿Qué influye más en tus decisiones de inversión?', 7, 'decision_social', 'Sigo principalmente análisis de personas que veo en redes', null, now() - interval '2 days - 5 minutes'),
  ('b1000000-0000-4000-8000-000000000001', 'rules', 'single_choice', '¿Tienes reglas claras sobre cuándo aumentar, reducir o cerrar una posición?', 8, 'rules_none', 'No tengo reglas claras', null, now() - interval '2 days - 4 minutes')
on conflict (envio_id, question_id) do nothing;
