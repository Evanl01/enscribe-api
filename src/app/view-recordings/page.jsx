"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as api from "@/public/scripts/api.js";
import * as format from "@/public/scripts/format.js";
import Auth from "@/src/components/Auth.jsx";
import RecordingPreviewOverlay from "@/src/components/RecordingPreviewOverlay.jsx";
import { getSupabaseClient } from "@/src/utils/supabase.js";

export default function ViewRecordings() {
  const router = useRouter();
  const [attachedRecordings, setAttachedRecordings] = useState([]);
  const [unattachedRecordings, setUnattachedRecordings] = useState([]);
  const [attachedSortBy, setAttachedSortBy] = useState("name");
  const [unattachedSortBy, setUnattachedSortBy] = useState("name");
  // Active tab: 'attached' or 'unattached'
  const [activeTab, setActiveTab] = useState("attached");
  const [loading, setLoading] = useState(true);
  const [selectedRecording, setSelectedRecording] = useState(null);
  const [recordingData, setRecordingData] = useState(null);
  const [loadingRecording, setLoadingRecording] = useState(false);
  const [deletingRecording, setDeletingRecording] = useState(false);

  const fetchRecordings = async (attached, sortBy = "name") => {
    const jwt = api.getJWT();
    if (!jwt) {
      router.push("/login");
      return [];
    }

    try {
      const queryParams = new URLSearchParams({
        attached: attached.toString(),
        limit: '100',
        offset: '0',
        sortBy,
        order: 'asc'
      });

      const response = await fetch(`/api/recordings/attachments?${queryParams}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });

      if (!response.ok) {
        if (response.status === 401) {
          router.push("/login");
        }
        return [];
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`Error fetching ${attached ? 'attached' : 'unattached'} recordings:`, error);
      return [];
    }
  };

  const loadAllRecordings = async (attachedSort = attachedSortBy, unattachedSort = unattachedSortBy) => {
    setLoading(true);
    const [attached, unattached] = await Promise.all([
      fetchRecordings(true, attachedSort),
      fetchRecordings(false, unattachedSort)
    ]);
    
    setAttachedRecordings(attached);
    setUnattachedRecordings(unattached);
    setLoading(false);
  };

  useEffect(() => {
    loadAllRecordings();
  }, []);

  const handleAttachedSortChange = (newSort) => {
    setAttachedSortBy(newSort);
    loadAllRecordings(newSort, unattachedSortBy);
  };

  const handleUnattachedSortChange = (newSort) => {
    setUnattachedSortBy(newSort);
    loadAllRecordings(attachedSortBy, newSort);
  };

  const getRecordingName = (path) => {
    return path?.split("/").pop() || "unknown";
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return "Unknown size";
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const handleCardClick = async (recording) => {
    setSelectedRecording(recording);
    setLoadingRecording(true);
    setRecordingData(null);

    const jwt = api.getJWT();
    if (!jwt) {
      router.push("/login");
      return;
    }

    try {
      if (recording.id) {
        // Attached recording - fetch from API with signed URL generation
        const response = await fetch(`/api/recordings/${recording.id}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${jwt}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        });

        if (response.ok) {
          const data = await response.json();
          setRecordingData(data);
        } else {
          console.error('Failed to fetch recording data:', response.status);
        }
      } else {
        // Unattached recording - create signed URL directly
        const supabase = getSupabaseClient(`Bearer ${jwt}`);
        
        const { data: signedUrlData, error: signedError } = await supabase.storage
          .from('audio-files')
          .createSignedUrl(recording.path, 60 * 60); // 1 hour expiry

        if (signedError) {
          console.error('Signed URL error:', signedError);
        } else {
          setRecordingData({
            ...recording,
            recording_file_signed_url: signedUrlData.signedUrl,
            id: null // Mark as unattached
          });
        }
      }
    } catch (error) {
      console.error('Error fetching recording data:', error);
    } finally {
      setLoadingRecording(false);
    }
  };

  const closePreview = () => {
    setSelectedRecording(null);
    setRecordingData(null);
  };

  const handleDeleteClick = async () => {
    if (!selectedRecording) return;
    
    // Show warning alert and get confirmation
    let confirmMessage;
    if (selectedRecording.id) {
      confirmMessage = `Warning: This will delete the entire Patient Encounter!\n\nDeleting this recording will also permanently delete:\n• The associated Patient Encounter\n• All Transcripts\n• All SOAP Notes\n\nAre you sure you want to continue?`;
    } else {
      confirmMessage = `Are you sure you want to permanently delete this recording file from storage?`;
    }
    
    if (!confirm(confirmMessage)) {
      return;
    }
    
    setDeletingRecording(true);
    const jwt = api.getJWT();
    if (!jwt) {
      router.push("/login");
      return;
    }

    try {
      if (selectedRecording.id) {
        // Attached recording - delete via patient encounter API
        // TODO: Implement DELETE endpoint for /api/patient-encounters/complete
        console.log('Would delete patient encounter and all related data for recording:', selectedRecording.id);
        alert('Delete functionality for attached recordings will be implemented soon. This would delete the entire patient encounter, transcript, and SOAP notes.');
        
        // const response = await fetch(`/api/patient-encounters/complete?id=${selectedRecording.patientEncounter.id}`, {
        //   method: "DELETE",
        //   headers: {
        //     Authorization: `Bearer ${jwt}`,
        //     "Content-Type": "application/json",
        //   },
        // });
        // 
        // if (response.ok) {
        //   // Remove from local state
        //   setAttachedRecordings(prev => prev.filter(r => r.id !== selectedRecording.id));
        //   closePreview();
        // } else {
        //   console.error('Failed to delete patient encounter:', response.status);
        //   alert('Failed to delete recording. Please try again.');
        // }
      } else {
        // Unattached recording - delete from storage directly
        const supabase = getSupabaseClient(`Bearer ${jwt}`);
        
        const { error } = await supabase.storage
          .from('audio-files')
          .remove([selectedRecording.path]);

        if (error) {
          console.error('Storage delete error:', error);
          alert('Failed to delete recording. Please try again.');
        } else {
          // Remove from local state
          setUnattachedRecordings(prev => prev.filter(r => r.path !== selectedRecording.path));
          closePreview();
        }
      }
    } catch (error) {
      console.error('Error deleting recording:', error);
      alert('Failed to delete recording. Please try again.');
    } finally {
      setDeletingRecording(false);
    }
  };

  const getSortDisplayName = (sortValue) => {
    switch (sortValue) {
      case "name": return "A-Z";
      case "created_at": return "Date Created";
      case "updated_at": return "Date Updated";
      default: return "A-Z";
    }
  };

    const RecordingCard = ({ recording, isAttached }) => (
    <div
      className="recording-card"
      data-recording-path={recording.path}
      data-patient-encounter-id={isAttached ? recording.patientEncounter?.id : undefined}
      key={recording.path}
      style={{
        background: "#fff",
        borderRadius: "12px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        padding: "20px",
        minWidth: 0,
        width: "100%",
        display: "flex",
        flexDirection: "column",
        transition: "box-shadow 0.2s, transform 0.2s",
        cursor: "pointer",
        border: recording.missing ? "2px solid #ef4444" : "none",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.16)";
        e.currentTarget.style.transform = "translateY(-4px) scale(1.03)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
        e.currentTarget.style.transform = "none";
      }}
      onClick={() => handleCardClick(recording)}
    >
      <div
        className="recording-icon"
        style={{ fontSize: "2rem", marginBottom: "8px" }}
      >
        {recording.missing ? "❌" : "🎵"}
      </div>
      <div
        className="recording-title"
        style={{ 
          fontWeight: "bold", 
          marginBottom: "6px",
          fontSize: "1rem",
          wordBreak: "break-word"
        }}
      >
        {getRecordingName(recording.path)}
      </div>
      {isAttached && recording.patientEncounter && (
        <div
          className="patient-encounter-name"
          style={{
            fontWeight: "bold",
            fontSize: "0.85rem",
            color: "#2563eb",
            marginBottom: "6px",
            wordBreak: "break-word"
          }}
        >
          {recording.patientEncounter.name || "Unnamed Encounter"}
        </div>
      )}
      <div
        className="recording-size"
        style={{
          color: "#666",
          fontSize: "0.9rem",
          marginBottom: "8px"
        }}
      >
        {formatFileSize(recording.size)}
      </div>
      <div
        className="recording-date"
        style={{
          color: "#555",
          fontSize: "0.85em"
        }}
      >
        {recording.created_at ? format.formatTimestamp(recording.created_at) : "Unknown date"}
      </div>
      {recording.missing && (
        <div
          style={{
            color: "#ef4444",
            fontSize: "0.8rem",
            marginTop: "8px",
            fontStyle: "italic"
          }}
        >
          File missing from storage
        </div>
      )}
    </div>
  );

  return (
    <>
      <Auth />
      <div className="max-w-8xl mx-auto p-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">
            View Recordings ({attachedRecordings.length + unattachedRecordings.length})
          </h1>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "40px" }}>
            <p>Loading recordings...</p>
          </div>
        ) : (
          <>
            {/* Tabs for Attached / Unattached Recordings (dashboard style) */}
            <div className="tabs" style={{ display: "flex", borderBottom: "2px solid #e0e0e0", marginBottom: "20px", backgroundColor: "#f8f9fa" }}>
              <button
                className={`tab-btn${activeTab === 'attached' ? ' active' : ''}`}
                onClick={() => setActiveTab('attached')}
                style={{ flex: 1, padding: '12px 20px', border: 'none', backgroundColor: activeTab === 'attached' ? '#007bff' : 'transparent', color: activeTab === 'attached' ? 'white' : '#495057', cursor: 'pointer', fontSize: '14px', fontWeight: '500', borderBottom: activeTab === 'attached' ? '3px solid #0056b3' : '3px solid transparent', transition: 'all 0.3s ease' }}
              >
                🎵 Attached ({attachedRecordings.length})
              </button>
              <button
                className={`tab-btn${activeTab === 'unattached' ? ' active' : ''}`}
                onClick={() => setActiveTab('unattached')}
                style={{ flex: 1, padding: '12px 20px', border: 'none', backgroundColor: activeTab === 'unattached' ? '#007bff' : 'transparent', color: activeTab === 'unattached' ? 'white' : '#495057', cursor: 'pointer', fontSize: '14px', fontWeight: '500', borderBottom: activeTab === 'unattached' ? '3px solid #0056b3' : '3px solid transparent', transition: 'all 0.3s ease' }}
              >
                🎵 Unattached ({unattachedRecordings.length})
              </button>
            </div>
          </>
        )}

        {/* Attached recordings tab content */}
        {!loading && activeTab === 'attached' && (
          <div className="tab-content" style={{ display: activeTab === 'attached' ? 'block' : 'none' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div />
              <div className="flex items-center gap-2">
                <label htmlFor="attachedSortBy" className="text-sm font-medium text-gray-700">Sort by</label>
                <select
                  id="attachedSortBy"
                  value={attachedSortBy}
                  onChange={(e) => handleAttachedSortChange(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                >
                  <option value="name">A-Z</option>
                  <option value="created_at">Date Created</option>
                  <option value="updated_at">Date Updated</option>
                </select>
              </div>
            </div>
            <div className="responsive-grid" id="attachedRecordings" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '20px', width: '100%', margin: '0 auto' }}>
              {attachedRecordings.length === 0 ? (
                <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
                  <div className="empty-icon">🎵</div>
                  <div className="empty-text">No attached recordings found</div>
                </div>
              ) : (
                attachedRecordings.map((recording) => (
                  <RecordingCard key={recording.path} recording={recording} isAttached={true} />
                ))
              )}
            </div>
          </div>
        )}

        {/* Unattached recordings tab content */}
        {!loading && activeTab === 'unattached' && (
          <div className="tab-content" style={{ display: activeTab === 'unattached' ? 'block' : 'none' }}>
            {/* Data retention notice */}
            <div style={{ 
              backgroundColor: '#fef3c7', 
              border: '1px solid #f59e0b', 
              borderRadius: '8px', 
              padding: '12px 16px', 
              marginBottom: '16px',
              fontSize: '14px',
              color: '#92400e'
            }}>
              ⚠️ These recordings have not been linked to a patient encounter. Please review and attach them, otherwise they will be removed per our data retention policy.
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div />
              <div className="flex items-center gap-2">
                <label htmlFor="unattachedSortBy" className="text-sm font-medium text-gray-700">Sort by</label>
                <select
                  id="unattachedSortBy"
                  value={unattachedSortBy}
                  onChange={(e) => handleUnattachedSortChange(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                >
                  <option value="name">A-Z</option>
                  <option value="created_at">Date Created</option>
                  <option value="updated_at">Date Updated</option>
                </select>
              </div>
            </div>
            <div className="responsive-grid" id="unattachedRecordings" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '20px', width: '100%', margin: '0 auto' }}>
              {unattachedRecordings.length === 0 ? (
                <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
                  <div className="empty-icon">🎵</div>
                  <div className="empty-text">No unattached recordings found</div>
                </div>
              ) : (
                unattachedRecordings.map((recording) => (
                  <RecordingCard key={recording.path} recording={recording} isAttached={false} />
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <RecordingPreviewOverlay
        selectedRecording={selectedRecording}
        recordingData={recordingData}
        loadingRecording={loadingRecording}
        deletingRecording={deletingRecording}
        onClose={closePreview}
        onDeleteClick={handleDeleteClick}
      />
    </>
  );
}
