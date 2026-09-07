// src/components/CloudStoragePickerModal.tsx
// e-Bro ERP Cloudflare R2 클라우드 스토리지 파일/폴더 탐색기 모달

import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  Folder,
  File,
  ArrowLeft,
  Search,
  X,
  Check,
  Link,
  ChevronRight,
  ExternalLink,
  FileText,
  RefreshCw,
  Cloud
} from 'lucide-react';

export interface CloudStoragePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (pathOrLink: string, item?: any) => void;
  mode?: 'file' | 'folder' | 'both';
  title?: string;
  initialValue?: string;
}

export const CloudStoragePickerModal: React.FC<CloudStoragePickerModalProps> = ({
  isOpen,
  onClose,
  onSelect,
  mode = 'both',
  title = '클라우드 스토리지 탐색기',
  initialValue = ''
}) => {
  const { googleConfigs } = useApp();
  const config = googleConfigs[0];

  const [activeTab, setActiveTab] = useState<'r2' | 'url'>('r2');
  const [currentPrefix, setCurrentPrefix] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [r2Files, setR2Files] = useState<Array<{ key: string; size: number; lastModified: string }>>([]);
  const [rawUrlInput, setRawUrlInput] = useState<string>(initialValue);

  const accountId = config?.r2AccountId || '35014a2514680107d74e1e68d96e6c32';
  const bucketName = config?.r2BucketName || 'kiyeun-storage';
  const accessKeyId = config?.r2AccessKeyId || '03cdb7560d37242de608a5db2a976030';
  const secretAccessKey = config?.r2SecretAccessKey || 'b2407ab4532e02317860bc3d63226fb7bc232e88083b150c15023906ed141986';
  const publicDomain = config?.r2PublicDomain || 'https://pub-a2fd3c2ae0cc450b8ebe34baf1b051e1.r2.dev';

  const fetchR2Files = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/r2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'list',
          accountId,
          bucketName,
          accessKeyId,
          secretAccessKey
        })
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.files)) {
        setR2Files(data.files);
      } else {
        setR2Files([]);
      }
    } catch (err) {
      console.warn('R2 파일 목록 조회 오류:', err);
      setR2Files([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchR2Files();
      setRawUrlInput(initialValue);
    }
  }, [isOpen]);

  // 현재 경로(prefix) 기준 하위 가상 폴더 및 직속 파일 추출
  const { currentFolders, currentFiles } = useMemo(() => {
    const foldersSet = new Set<string>();
    const files: Array<{ key: string; name: string; size: number; lastModified: string }> = [];

    r2Files.forEach(file => {
      let relativeKey = file.key;
      if (currentPrefix) {
        if (!file.key.startsWith(currentPrefix)) return;
        relativeKey = file.key.slice(currentPrefix.length);
      }

      if (relativeKey.startsWith('/')) relativeKey = relativeKey.slice(1);

      const slashIndex = relativeKey.indexOf('/');
      if (slashIndex !== -1) {
        // 하위 폴더 존재
        const folderName = relativeKey.slice(0, slashIndex);
        foldersSet.add(folderName);
      } else if (relativeKey) {
        // 직속 파일
        files.push({
          key: file.key,
          name: relativeKey,
          size: file.size,
          lastModified: file.lastModified
        });
      }
    });

    const folders = Array.from(foldersSet).sort();
    return { currentFolders: folders, currentFiles: files };
  }, [r2Files, currentPrefix]);

  // 검색 필터링
  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return currentFiles;
    return currentFiles.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [currentFiles, searchQuery]);

  const filteredFolders = useMemo(() => {
    if (!searchQuery.trim()) return currentFolders;
    return currentFolders.filter(f => f.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [currentFolders, searchQuery]);

  if (!isOpen) return null;

  const handleSelectFile = (fileKey: string) => {
    const fullPublicUrl = publicDomain ? `${publicDomain.replace(/\/$/, '')}/${fileKey.split('/').map(encodeURIComponent).join('/')}` : fileKey;
    onSelect(fullPublicUrl, { key: fileKey });
    onClose();
  };

  const handleSelectFolder = (folderName: string) => {
    const targetPath = currentPrefix ? `${currentPrefix}/${folderName}` : folderName;
    if (mode === 'folder' || mode === 'both') {
      onSelect(targetPath, { name: folderName, path: targetPath });
      onClose();
    }
  };

  const handleNavigateIntoFolder = (folderName: string) => {
    setCurrentPrefix(prev => prev ? `${prev}/${folderName}` : folderName);
    setSearchQuery('');
  };

  const handleNavigateUp = () => {
    if (!currentPrefix) return;
    const parts = currentPrefix.split('/');
    parts.pop();
    setCurrentPrefix(parts.join('/'));
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}>
      <div className="card" style={{ maxWidth: '780px', width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 0, borderRadius: '16px', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.3)' }}>
        
        {/* 헤더 */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-app)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Cloud size={18} style={{ color: 'var(--primary)' }} />
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800' }}>{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-muted)' }}
          >
            ✕
          </button>
        </div>

        {/* 탭 네비게이션 */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--bg-card)' }}>
          <button
            type="button"
            onClick={() => setActiveTab('r2')}
            style={{
              flex: 1,
              padding: '10px 16px',
              border: 'none',
              background: 'none',
              borderBottom: activeTab === 'r2' ? '2px solid var(--primary)' : 'none',
              color: activeTab === 'r2' ? 'var(--primary)' : 'var(--text-secondary)',
              fontWeight: activeTab === 'r2' ? '700' : '500',
              fontSize: '13px',
              cursor: 'pointer'
            }}
          >
            R2 버킷 파일 탐색
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('url')}
            style={{
              flex: 1,
              padding: '10px 16px',
              border: 'none',
              background: 'none',
              borderBottom: activeTab === 'url' ? '2px solid var(--primary)' : 'none',
              color: activeTab === 'url' ? 'var(--primary)' : 'var(--text-secondary)',
              fontWeight: activeTab === 'url' ? '700' : '500',
              fontSize: '13px',
              cursor: 'pointer'
            }}
          >
            직접 링크 / URL 입력
          </button>
        </div>

        {/* 바디 */}
        {activeTab === 'r2' ? (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: '350px', maxHeight: '55vh', overflow: 'hidden' }}>
            
            {/* 검색 및 상위 이동 툴바 */}
            <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: '10px', alignItems: 'center', backgroundColor: 'var(--bg-app)' }}>
              {currentPrefix && (
                <button
                  type="button"
                  onClick={handleNavigateUp}
                  className="btn-secondary"
                  style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', whiteSpace: 'nowrap' }}
                >
                  <ArrowLeft size={14} /> 상위
                </button>
              )}

              {/* 브레드크럼 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span
                  onClick={() => setCurrentPrefix('')}
                  style={{ cursor: 'pointer', fontWeight: !currentPrefix ? '700' : '500', color: !currentPrefix ? 'var(--primary)' : 'inherit' }}
                >
                  root ({bucketName})
                </span>
                {currentPrefix && currentPrefix.split('/').map((part, idx, arr) => (
                  <React.Fragment key={idx}>
                    <ChevronRight size={12} />
                    <span
                      onClick={() => setCurrentPrefix(arr.slice(0, idx + 1).join('/'))}
                      style={{ cursor: 'pointer', fontWeight: idx === arr.length - 1 ? '700' : '500', color: idx === arr.length - 1 ? 'var(--primary)' : 'inherit' }}
                    >
                      {part}
                    </span>
                  </React.Fragment>
                ))}
              </div>

              {/* 검색창 */}
              <div style={{ position: 'relative', width: '180px' }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="파일명 검색..."
                  style={{ width: '100%', padding: '6px 26px 6px 8px', fontSize: '12px', borderRadius: '6px', border: '1px solid var(--border)' }}
                />
                <Search size={13} style={{ position: 'absolute', right: '8px', top: '8px', color: 'var(--text-muted)' }} />
              </div>

              {/* 새로고침 */}
              <button
                type="button"
                onClick={fetchR2Files}
                disabled={isLoading}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
              </button>
            </div>

            {/* 목록 영역 */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
              {isLoading ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                  <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 10px auto' }} />
                  <p style={{ margin: 0, fontSize: '13px' }}>R2 버킷 파일 목록 탐색 중...</p>
                </div>
              ) : filteredFolders.length === 0 && filteredFiles.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                  <p style={{ margin: 0, fontSize: '13px' }}>표시할 항목이 없습니다.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {/* 폴더 목록 */}
                  {filteredFolders.map(folder => (
                    <div
                      key={folder}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: '6px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border)' }}
                    >
                      <div
                        onClick={() => handleNavigateIntoFolder(folder)}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', flex: 1 }}
                      >
                        <Folder size={16} style={{ color: '#F59E0B' }} />
                        <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>{folder}</span>
                      </div>
                      {(mode === 'folder' || mode === 'both') && (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => handleSelectFolder(folder)}
                          style={{ padding: '3px 8px', fontSize: '11px', fontWeight: '700', whiteSpace: 'nowrap' }}
                        >
                          폴더 선택
                        </button>
                      )}
                    </div>
                  ))}

                  {/* 파일 목록 */}
                  {filteredFiles.map(file => (
                    <div
                      key={file.key}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: '6px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, overflow: 'hidden' }}>
                        <FileText size={15} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                        <span style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {file.name}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          ({(file.size / 1024).toFixed(1)} KB)
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => handleSelectFile(file.key)}
                        style={{ padding: '4px 10px', fontSize: '11px', fontWeight: '700', whiteSpace: 'nowrap' }}
                      >
                        선택
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        ) : (
          /* 직접 URL 입력 탭 */
          <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)' }}>
                스토리지 파일 URL 또는 경로 직접 입력
              </label>
              <input
                type="text"
                value={rawUrlInput}
                onChange={e => setRawUrlInput(e.target.value)}
                placeholder="예: https://pub-xxxx.r2.dev/01.사업자/사업자등록증.pdf 또는 파일 경로"
                style={{ padding: '10px 12px', fontSize: '13px', borderRadius: '6px', border: '1px solid var(--border)' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={onClose}
                style={{ padding: '6px 14px', fontSize: '12px' }}
              >
                취소
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  if (!rawUrlInput.trim()) {
                    alert('URL 또는 경로를 입력해 주세요.');
                    return;
                  }
                  onSelect(rawUrlInput.trim());
                  onClose();
                }}
                style={{ padding: '6px 16px', fontSize: '12px', fontWeight: '700' }}
              >
                적용
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
