$url = "https://eqyycmmbcesrtxuawyyb.supabase.co/rest/v1/"
$key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxeXljbW1iY2VzcnR4dWF3eXliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNjMyNTUsImV4cCI6MjA5OTYzOTI1NX0.zZbz5KFlfP-WjDH8ctKY2Ql1eawQ6yU6y469JI5QrLo"
$headers = @{ "apikey" = $key; "Authorization" = "Bearer $key"; "Content-Type" = "application/json" }
$tables = @("employees", "sites", "departments", "designations", "shifts", "presence_sessions", "location_logs", "audit_logs")

foreach ($table in $tables) {
    $data = Invoke-RestMethod -Method Get -Uri ($url + $table + "?select=id&limit=1000") -Headers $headers -ErrorAction SilentlyContinue
    $count = ($data | Measure-Object).Count
    Write-Host ($table + ": " + $count + " records")
}