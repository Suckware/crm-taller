-- Sesión única: ya publicada la web que ocupa la sesión al entrar, solo vale
-- la sesión que tiene el usuario (sin fila = sin acceso hasta que la ocupe).
create or replace function public.sesion_vigente()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.sesiones s
    where s.user_id = auth.uid()
      and s.session_id::text = (auth.jwt() ->> 'session_id')
  )
$$;
