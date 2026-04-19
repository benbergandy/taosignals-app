import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://ofbdkvoyodxyqzxqcerr.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mYmRrdm95b2R4eXF6eHFjZXJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NDU2NjIsImV4cCI6MjA5MjEyMTY2Mn0.mXy237k1du2tZVb2zE4KIQhtyCtHNl9oDLsYhXqQYVk'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export const API_BASE = 'https://api.taosignals.io:8443'
