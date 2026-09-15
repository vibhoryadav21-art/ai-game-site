import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.https://wvooyliulhsqzxrsomnk.supabase.co/rest/v1/
const supabaseAnonKey = process.env.eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2b295bGl1bGhzcXp4cnNvbW5rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0MTk0OTcsImV4cCI6MjEwNDk5NTQ5N30.O2OB3DaoYPArvtazcDT11SVQC9LyQksRjKK2OZy_rQ0

export const supabase = createClient(supabaseUrl, supabaseAnonKey)