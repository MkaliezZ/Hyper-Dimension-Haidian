param([Parameter(Mandatory=$true)][string]$Uri,[Parameter(Mandatory=$true)][string]$OutFile)
$ErrorActionPreference='Stop'
if (([Uri]$Uri).Host -ne 'gis.maps.uw.edu') { throw 'UW GIS host only' }
# Windows certificate-chain verification through the system trust store; no insecure TLS mode.
Invoke-WebRequest -Uri $Uri -TimeoutSec 90 -OutFile $OutFile
