$url = "https://eqyycmmbcesrtxuawyyb.supabase.co/rest/v1/"
$key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxeXljbW1iY2VzcnR4dWF3eXliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNjMyNTUsImV4cCI6MjA5OTYzOTI1NX0.zZbz5KFlfP-WjDH8ctKY2Ql1eawQ6yU6y469JI5QrLo"
$headers = @{ "apikey" = $key; "Authorization" = "Bearer $key"; "Content-Type" = "application/json" }

# Check employee_sites with different column
$data = Invoke-RestMethod -Method Get -Uri ($url + "employee_sites?select=employee_id,site_id&limit=1000") -Headers $headers -ErrorAction SilentlyContinue
$count = ($data | Measure-Object).Count
Write-Host ("employee_sites: " + $count + " records")

# Check auth.users via admin endpoint (requires service role, won't work with anon)
# Just check if we can access it
try {
    $resp = Invoke-RestMethod -Method Get -Uri ($url + "auth/v1/users") -Headers $headers -ErrorAction Stop
    Write-Host ("auth.users accessible: " + ($resp | Measure-Object).Count)
} catch {
    Write-Host "auth.users not accessible with anon key (expected)"
}