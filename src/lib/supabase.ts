import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://zcljlddtcoyfyvshlyfk.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpjbGpsZGR0Y295Znl2c2hseWZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NDU0ODQsImV4cCI6MjEwNDAyMTQ4NH0.tBeu7TJpnEwSIcBMTC86G8-1EF4p1xaqPy_nxtaqv2Q";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);