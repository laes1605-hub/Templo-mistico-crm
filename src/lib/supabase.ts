import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qrrkokfmbdtodrqbfehs.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFycmtva2ZtYmR0b2RycWJmZWhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxOTU1NDUsImV4cCI6MjEwMjc3MTU0NX0.pPbrwPjodbOg8xstoDekDHedQyZNQgmqLX4LShX0t2M";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);