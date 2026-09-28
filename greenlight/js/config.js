/* GREENLIGHT community config: the ONLY file to edit to switch community features on.
   Leave supabaseUrl / supabaseAnonKey empty and every community section shows "Coming soon".
   supabaseAnonKey: the project's anon key or sb_publishable_... key. It is safe to publish;
   Row Level Security protects the data.
   Never put a service_role / secret key here. */
window.GREENLIGHT_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  oauth: { github: false, google: false },   // set true once the provider is enabled in Supabase Auth
  reportThreshold: 3,                         // display only; the database setting is authoritative
};
