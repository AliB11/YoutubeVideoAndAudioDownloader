; ---------------------------------------------------------------------------
;  اسکریپت ساخت نصب‌کننده‌ی ویندوز «یوتیوب دانلودر» با Inno Setup 6
;
;  این فایل به‌صورت خودکار توسط build.ps1 اجرا می‌شود و این مقادیر را از خط فرمان
;  دریافت می‌کند:
;     /DAppVersion=1.0.0        نسخه‌ی برنامه
;     /DSourceDir=C:\path\app   پوشه‌ی آماده‌شده‌ی برنامه (خروجی build.ps1)
;     /DOutputDir=C:\path\dist  پوشه‌ی خروجی نصب‌کننده
;
;  اجرای دستی:
;     ISCC.exe /DAppVersion=1.0.0 /DSourceDir=dist\work\YouTubeDownloader /DOutputDir=dist installer.iss
; ---------------------------------------------------------------------------

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\work\YouTubeDownloader"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef AssetsDir
  #define AssetsDir "assets"
#endif

#define AppName "یوتیوب دانلودر"
#define AppNameEn "YouTube Downloader"
#define AppPublisher "AliB11"
#define AppUrl "https://github.com/AliB11/YoutubeVideoAndAudioDownloader"

[Setup]
; شناسه‌ی یکتای برنامه (نباید هرگز تغییر کند تا به‌روزرسانی‌ها درست کار کنند)
AppId={{7C4B1E92-5D3A-4F27-9C6E-8A1B2D3E4F50}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}/issues
AppUpdatesURL={#AppUrl}/releases
VersionInfoVersion={#AppVersion}
VersionInfoCompany={#AppPublisher}
VersionInfoDescription={#AppNameEn} {#AppVersion} Setup
VersionInfoProductName={#AppNameEn}
DefaultDirName={localappdata}\YouTubeDownloader
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=no
AllowNoIcons=yes
; نصب برای کاربر جاری، بدون نیاز به دسترسی مدیر (بدون UAC)
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline
LicenseFile={#AssetsDir}\license.txt
OutputDir={#OutputDir}
OutputBaseFilename=YouTubeDownloader-Setup-{#AppVersion}-x64
SetupIconFile={#AssetsDir}\app.ico
UninstallDisplayIcon={app}\app.ico
UninstallDisplayName={#AppName} {#AppVersion}
Compression=lzma2/max
SolidCompression=yes
LZMAUseSeparateProcess=yes
WizardStyle=modern
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
MinVersion=10.0
CloseApplications=no
RestartApplications=no
; نام فایل نصب‌کننده‌ی قبلی برای به‌روزرسانی درجا
UsePreviousAppDir=yes
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

; ---------------------------------------------------------------------------
; ترجمه‌ی فارسی متن‌های پرکاربرد ویزارد (بقیه به انگلیسی می‌ماند)
; ---------------------------------------------------------------------------
[Messages]
SetupAppTitle=راه‌انداز
SetupWindowTitle=نصب %1
UninstallAppTitle=حذف برنامه
UninstallAppFullTitle=حذف %1
WelcomeLabel1=به راه‌انداز %1 خوش آمدید
WelcomeLabel2=این برنامه «{#AppName}» را روی رایانه‌ی شما نصب می‌کند.%n%nبرای ادامه روی «بعدی» کلیک کنید.
SelectDirLabel3=برنامه در پوشه‌ی زیر نصب می‌شود.
SelectDirBrowseLabel=برای ادامه روی «بعدی» کلیک کنید. اگر می‌خواهید پوشه‌ی دیگری انتخاب کنید، روی «مرور» کلیک کنید.
DiskSpaceMBLabel=حداقل %1 مگابایت فضای خالی روی دیسک لازم است.
SelectTasksLabel2=کارهای اضافی مورد نظر را انتخاب کنید، سپس روی «بعدی» کلیک کنید:
CreateDesktopIcon=ساخت میانبر روی میزکار
SelectStartMenuFolderLabel3=میانبرهای برنامه در پوشه‌ی زیر در منوی استارت ساخته می‌شوند.
SelectStartMenuFolderBrowseLabel=برای ادامه روی «بعدی» کلیک کنید. اگر می‌خواهید پوشه‌ی دیگری انتخاب کنید، روی «مرور» کلیک کنید.
ReadyLabel1=راه‌انداز آماده‌ی نصب %1 روی رایانه‌ی شماست.
ReadyLabel2a=برای شروع نصب روی «نصب» کلیک کنید، یا اگر می‌خواهید تنظیمات را تغییر دهید روی «قبلی» کلیک کنید.
InstallingLabel=لطفاً تا پایان نصب صبر کنید...
FinishedLabel=برنامه با موفقیت نصب شد.%n%nبرای اجرا، از میانبر «{#AppName}» استفاده کنید.
ClickFinish=برای پایان، روی «پایان» کلیک کنید.
ButtonNext=بعدی >
ButtonBack=< قبلی
ButtonInstall=نصب
ButtonFinish=پایان
ButtonCancel=انصراف
ButtonBrowse=مرور...
ButtonYes=بله
ButtonNo=خیر
ConfirmUninstall=آیا از حذف %1 و همه‌ی اجزای آن مطمئن هستید؟
UninstallStatusLabel=در حال حذف %1، لطفاً صبر کنید...
UninstallUninstalling=در حال حذف...

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "autostart"; Description: "اجرای سرویس هنگام روشن‌شدن ویندوز (پنجره‌ی سرویس باز می‌ماند)"; GroupDescription: "گزینه‌های اضافی"; Flags: unchecked

[Files]
; کل پوشه‌ی آماده‌شده‌ی برنامه (runtime + node_modules + .next + tools + اسکریپت‌ها)
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#AssetsDir}\app.ico"; DestDir: "{app}"; Flags: ignoreversion
; راهنمای کاربر (README.txt) و فایل‌های راه‌انداز از پوشه‌ی آماده‌شده کپی می‌شوند

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\Start-YouTubeDownloader.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\app.ico"; Comment: "اجرای سرویس محلی دانلود"
Name: "{group}\توقف سرویس"; Filename: "{app}\Stop-YouTubeDownloader.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\app.ico"
Name: "{group}\به‌روزرسانی yt-dlp"; Filename: "{app}\Update-yt-dlp.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\app.ico"
Name: "{group}\پوشه‌ی فایل‌ها و گزارش‌ها"; Filename: "{app}\data"; IconFilename: "{app}\app.ico"
Name: "{group}\حذف {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\Start-YouTubeDownloader.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\app.ico"; Tasks: desktopicon
Name: "{userstartup}\{#AppName}"; Filename: "{app}\Start-YouTubeDownloader.cmd"; WorkingDir: "{app}"; Tasks: autostart

[Run]
Filename: "{app}\Start-YouTubeDownloader.cmd"; Description: "اجرای {#AppName}"; Flags: nowait postinstall skipifsilent shellexec

[UninstallRun]
; پیش از حذف، سرویس در حال اجرا متوقف می‌شود (بدون نیاز به اجرای مرورگر یا پنجره‌ی اضافه)
Filename: "{app}\Stop-YouTubeDownloader.cmd"; Flags: runhidden waituntilterminated; RunOnceId: "StopServer"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\data"
Type: filesandordirs; Name: "{app}\.next\cache"
Type: files; Name: "{app}\.env"
Type: files; Name: "{app}\VERSION.txt"

[Registry]
; ثبت مسیر نصب برای ابزارهای جانبی (اختیاری)
Root: HKCU; Subkey: "Software\{#AppNameEn}"; ValueType: string; ValueName: "InstallPath"; ValueData: "{app}"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\{#AppNameEn}"; ValueType: string; ValueName: "Version"; ValueData: "{#AppVersion}"; Flags: uninsdeletekey

[Code]
{ بررسی این‌که پوشه‌ی برنامه سالم است (runtime و node_modules وجود دارند) }
function InitializeSetup(): Boolean;
begin
  Result := True;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    if not FileExists(ExpandConstant('{app}\runtime\node.exe')) then
      MsgBox('هشدار: فایل runtime\node.exe در بسته پیدا نشد؛ برنامه ممکن است اجرا نشود.', mbError, MB_OK);
  end;
end;
