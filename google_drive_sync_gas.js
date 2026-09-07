/**
 * ==============================================================================
 * (주)기업엔리프트 ERP <-> Google Drive 실물 자동 동기화 Google Apps Script (GAS)
 * ==============================================================================
 * 
 * [최초 권한 승인 방법 (10초 완료)]:
 * 1. 코드 붙여넣기 후, 상단 메인 툴바의 함수 선택창에서 [testRun] 을 선택합니다.
 * 2. [실행] 버튼을 클릭하면 [권한 검토] 팝업이 나타납니다.
 * 3. 계정 선택 ➔ 하단 [Advanced](고급) ➔ [Go to project (unsafe)](이동) ➔ [Allow](허용) 클릭!
 * 4. 권한 승인 후 우측 상단 [배포] ➔ [새 배포] ➔ 유형: 웹 앱 (나 / 누구나) ➔ 배포 완료!
 */

// 1. 최초 1회 권한 승인용 실행 함수 (상단 [실행] 버튼용)
function testRun() {
  var root = DriveApp.getRootFolder();
  Logger.log('Google Drive 연결 승인 완료: ' + root.getName());
}

// 2. ERP 시스템 자동 파일 생성/업로드 Webhook 엔진
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var folderName = data.folderName || '소모품납품';
    var fileName = data.fileName || ('증빙문서_' + new Date().getTime());
    var mimeType = data.mimeType || 'application/pdf';
    var base64Data = data.base64Data || '';

    // 최상위 루트 폴더 [Giyeun_Lift] 조회 및 미존재 시 자동 생성
    var rootFolderName = 'Giyeun_Lift';
    var rootFolder;
    var rootFolders = DriveApp.getFoldersByName(rootFolderName);
    if (rootFolders.hasNext()) {
      rootFolder = rootFolders.next();
    } else {
      rootFolder = DriveApp.createFolder(rootFolderName);
    }

    // 하위 업무별 지정 폴더 (예: 소모품납품, 운송료 등) 조회 및 자동 생성
    var targetFolder;
    var targetFolders = rootFolder.getFoldersByName(folderName);
    if (targetFolders.hasNext()) {
      targetFolder = targetFolders.next();
    } else {
      targetFolder = rootFolder.createFolder(folderName);
    }

    // Base64 헤더 제거 (data:image/jpeg;base64, ... 등)
    var rawBase64 = base64Data;
    if (rawBase64.indexOf(',') !== -1) {
      rawBase64 = rawBase64.split(',')[1];
    }

    // 바이너리 바이트 블롭(Blob) 생성
    var decodedBytes = Utilities.base64Decode(rawBase64);
    var blob = Utilities.newBlob(decodedBytes, mimeType, fileName);

    // 구글 드라이브에 실물 파일 업로드 생성
    var file = targetFolder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var fileUrl = file.getUrl();
    var fileId = file.getId();

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      fileId: fileId,
      fileName: fileName,
      fileUrl: fileUrl,
      folderName: folderName,
      message: '구글 드라이브에 파일이 성공적으로 보존되었습니다.'
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.toString(),
      message: '구글 드라이브 업로드 실패: ' + err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: 'ONLINE',
    system: '(주)기업엔리프트 구글드라이브 자동 동기화 API 엔진'
  })).setMimeType(ContentService.MimeType.JSON);
}
