// Conexión a Supabase (proyecto de Tiempos DAC). La clave "publishable" es pública por diseño:
// la seguridad la dan las políticas RLS de supabase/schema.sql (solo lectura y pedir actualización).
// Con ?local en la dirección la app lee public/local/datos.json (generado con actualizar.py --local).
window.AUD_CONFIG = {
  SUPABASE_URL: 'https://lzgteejsjxrbadsqlpnd.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_3v2gGe5N9Oh1eW-9ywMb1g_3Buo8af8',
};
