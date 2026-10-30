param([string]$QueryFile)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CrewtraxaWipeCredential {
 [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool Read(string target, uint type, uint flags, out IntPtr credential);
 [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr buffer);
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct Credential { public uint Flags; public uint Type; public string TargetName; public string Comment; public long LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist; public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
 public static string Token() { IntPtr ptr; if (!Read("Supabase CLI:supabase",1,0,out ptr)) throw new Exception("Supabase CLI credential unavailable"); try { var c=Marshal.PtrToStructure<Credential>(ptr); byte[] blob=new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob,blob,0,blob.Length); return System.Text.Encoding.UTF8.GetString(blob).TrimEnd('\0'); } finally { CredFree(ptr); } }
}
"@
$token = [CrewtraxaWipeCredential]::Token()
$headers = @{ Authorization = "Bearer $token" }
$body = @{ query = [string](Get-Content -Raw -LiteralPath $QueryFile) } | ConvertTo-Json
try { Invoke-RestMethod -Method Post -Uri 'https://api.supabase.com/v1/projects/eqyycmmbcesrtxuawyyb/database/query' -Headers $headers -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 12 } catch { Write-Output $_.Exception.Message; Write-Output $_.ErrorDetails.Message; exit 1 }
