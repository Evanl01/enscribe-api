"use client";
import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as api from "@/public/scripts/api.js";
import * as ui from "@/public/scripts/ui.js";
import * as format from "@/public/scripts/format.js";
import * as validation from "@/public/scripts/validation.js";
import parseSoapNotes from "@/src/utils/parseSoapNotes";
import Auth from "@/src/components/Auth";

// Pagination constants for SOAP notes queries
const SOAP_NOTES_PAGINATION = {
  limit: 100,
  offset: 0,
  sortBy: 'updated_at',
  order: 'desc',
};

const Dashboard = () => {
  const router = useRouter();
  const [transcripts, setTranscripts] = useState({});
  const [soapNotes, setSoapNotes] = useState({});
  const [soapNotesCount, setSoapNotesCount] = useState(0);
  const [dotPhrases, setDotPhrases] = useState({});
  const [patientEncounters, setPatientEncounters] = useState({});
  const [patientEncountersCount, setPatientEncountersCount] = useState(0);
  const [recentTranscripts, setRecentTranscripts] = useState([]);
  const [recentSoapNotes, setRecentSoapNotes] = useState([]);
  const [recentPatientEncounters, setRecentPatientEncounters] = useState([]);
  // Restore last tab from localStorage, default to "encounters"
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("dashboardActiveTab") || "encounters";
    }
    return "encounters";
  });
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settings, setSettings] = useState({
    apiKeys: {},
    defaultTemplate: "standard",
  });
  const [testBtnState, setTestBtnState] = useState({
    text: "Test Connection",
    disabled: false,
  });
  const tabMenu = [
    { key: "encounters", label: "Patient Encounters", icon: "🏥" },
    { key: "soap", label: "SOAP Notes", icon: "📋" },
  ];

  // Load stats and recent items on mount
  useEffect(() => {
    loadStats();
    loadRecentItems();
    // Restore tab on mount (in case SSR defaulted)
    if (typeof window !== "undefined") {
      const storedTab = localStorage.getItem("dashboardActiveTab");
      if (storedTab && storedTab !== activeTab) {
        setActiveTab(storedTab);
      }
    }
  }, []);

  const loadStats = async () => {
    const [t, s, d, p] = await Promise.all([
      api.getAllTranscripts({ cache: "no-store" }),
      api.getAllSoapNotes({ cache: "no-store" }),
      api.getAllDotPhrases({ cache: "no-store" }),
      loadRecentPatientEncounters(), // Load patient encounters for stats
    ]);
    setTranscripts(t);
    setSoapNotes(s);
    setDotPhrases(d);
  };

  const loadRecentItems = async () => {
    // await loadRecentTranscripts();
    await loadRecentSoapNotes();
    await loadRecentPatientEncounters();
  };

  const loadRecentPatientEncounters = async () => {
    const jwt = api.getJWT();
    if (!jwt) {
      // localStorage.removeItem("jwt");
      router.push("/login");
      // const errMsg =
      //   "User not logged in. Please log in to view patient encounters.";

      // return {};
    }

    try {
      const response = await fetch("/api/patient-encounters/batch", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        cache: "no-store", // Always fetch fresh data, never use cache
      });

      if (!response.ok) {
        let errorMsg = "Failed to fetch patient encounters";
        let errorStatus = response.status;
        try {
          const errorData = await response.json();
          if (errorData) {
            errorMsg += ": " + JSON.stringify(errorData);
            console.error("API error response:", errorData);
          }
        } catch {
          // ignore JSON parse error
        }
        // Throw custom error object with status
        throw { message: errorMsg, status: errorStatus };
      }

      const data = await response.json();
      console.log("Fetched patientEncounters:", data);

      // Set the full data for stats
      setPatientEncounters(data);
      setPatientEncountersCount(Object.keys(data).length);

      // Get recent items (last 5)
      const recent = Object.values(data).slice(0, 5);
      setRecentPatientEncounters(recent);

      return data;
    } catch (error) {
      router.push("/login");

      // if (error && error.status === 401) {
      //   alert("Token expired. Please log in again.");
      // } else {
      //   alert("Error fetching patient encounters: " + (error.message || error));
      // }
    }
  };

  const loadRecentSoapNotes = async () => {
    const jwt = api.getJWT();
    if (!jwt) {
      // localStorage.removeItem("jwt");
      router.push("/login");
      // const errMsg =
      //   "User not logged in. Please log in to view patient encounters.";

      // return {};
    }

    try {
      const queryParams = new URLSearchParams(SOAP_NOTES_PAGINATION).toString();
      const response = await fetch(`/api/soap-notes?${queryParams}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        cache: "no-store", // Always fetch fresh data, never use cache
      });

      if (!response.ok) {
        let errorMsg = "Failed to fetch soap notes";
        let errorStatus = response.status;
        try {
          const errorData = await response.json();
          if (errorData) {
            errorMsg += ": " + JSON.stringify(errorData);
            console.error("API error response:", errorData);
          }
        } catch {
          // ignore JSON parse error
        }
        // Throw custom error object with status
        throw { message: errorMsg, status: errorStatus };
      }

      const data = await response.json();
      const parsedSoapNotes = parseSoapNotes(data);
      console.log("Fetched soapNotes:", parsedSoapNotes);

      // Set the full data for stats
      setSoapNotes(parsedSoapNotes);
      setSoapNotesCount(Object.keys(parsedSoapNotes).length);

      // Get recent items (last 5)
      const recent = Object.values(parsedSoapNotes).slice(0, 5);
      setRecentSoapNotes(recent);

      return data;
    } catch (error) {
      if (error && error.status === 401) {
        alert("Token expired. Please log in again.");
        router.push("/login");
        return;
      } else {
        alert("Error fetching soap notes: " + (error.message || error));
        router.push("/login");
      }
    }
  };

  // Tab switching
  const switchTab = (tabName) => {
    setActiveTab(tabName);
    if (typeof window !== "undefined") {
      localStorage.setItem("dashboardActiveTab", tabName);
    }
  };

  // Settings modal handlers
  const openSettingsModal = async () => {
    // Simulate chrome.storage.local.get
    // Replace with your own storage logic if needed
    // For now, just use state
    setSettingsModalOpen(true);
  };
  const closeSettingsModal = () => setSettingsModalOpen(false);
  const saveSettings = async () => {
    // Simulate chrome.storage.local.set
    setSettings({ ...settings });
    ui.showToast("Settings saved successfully!", "success");
    closeSettingsModal();
  };

  // Test connection button
  const testConnections = async () => {
    setTestBtnState({ text: "Testing...", disabled: true });
    // Simulate test
    setTimeout(() => {
      setTestBtnState({ text: "Test Connection", disabled: false });
      ui.showToast("Test complete!", "success");
    }, 1000);
  };

  // Export data (placeholder)
  const exportData = () => {
    ui.showToast("Export feature coming soon!", "info");
  };

  // View/edit handlers (placeholders)
  const viewSoapNote = (id) => {
    ui.showToast(`View SOAP note ${id}`, "info");
  };
  const editSoapNote = (id) => {
    // alert(`Edit SOAP note ${id}`);
    // return;
    router.push(`/edit-soap-note?id=${id}`);
  };
  const viewPatientEncounter = (id) => {
    ui.showToast(`View patient encounter ${id}`, "info");
  };
  const editPatientEncounter = (id) => {
    // alert(`Edit patient encounter ${id}`);
    // return;
    router.push(`/edit-patient-encounter?id=${id}`);
  };

  // Render
  return (
    <>
      <Auth />
      <div className="dashboard-container">
        {/* <div className="stats">
          <div>Transcripts: {Object.keys(transcripts).length}</div>
          <div>SOAP Notes: {Object.keys(soapNotes).length}</div>
          <div>Dot Phrases: {Object.keys(dotPhrases).length}</div>
          <div>Patient Encounters: {Object.keys(patientEncounters).length}</div>
        </div> */}
        <h1 className="text-3xl font-bold mb-10">Dashboard</h1>

        <div
          className="tabs"
          style={{
            display: "flex",
            borderBottom: "2px solid #e0e0e0",
            marginBottom: "20px",
            backgroundColor: "#f8f9fa",
          }}
        >
          {tabMenu.map((tab) => (
            <button
              key={tab.key}
              className={`tab-btn${activeTab === tab.key ? " active" : ""}`}
              onClick={() => switchTab(tab.key)}
              data-tab={tab.key}
              style={{
                flex: 1,
                padding: "12px 20px",
                border: "none",
                backgroundColor:
                  activeTab === tab.key ? "#007bff" : "transparent",
                color: activeTab === tab.key ? "white" : "#495057",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: "500",
                borderBottom:
                  activeTab === tab.key
                    ? "3px solid #0056b3"
                    : "3px solid transparent",
                transition: "all 0.3s ease",
              }}
              onMouseEnter={(e) => {
                if (activeTab !== tab.key) {
                  e.target.style.backgroundColor = "#e9ecef";
                }
              }}
              onMouseLeave={(e) => {
                if (activeTab !== tab.key) {
                  e.target.style.backgroundColor = "transparent";
                }
              }}
            >
              {tab.icon} {tab.label} {"("}
              {tab.key === "encounters" && patientEncountersCount}
              {tab.key === "soap" && soapNotesCount}
              {")"}
            </button>
          ))}
        </div>

        {/* Recent Items Dashboard View - Always Visible */}
        {/* <div className="recent-items-dashboard">
          <div className="recent-section">
            <h3>Recent Transcripts</h3>
            <div id="recentTranscriptsDashboard">
              {recentTranscripts.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">📄</div>
                  <div className="empty-text">No transcripts yet</div>
                </div>
              ) : (
                recentTranscripts.map((transcript) => (
                  <div
                    className="recent-item"
                    data-id={transcript.id}
                    key={transcript.id}
                  >
                    <div className="recent-icon">📄</div>
                    <div className="recent-content">
                      <div className="recent-title">
                        {format.formatDisplayName(
                          transcript.created_at,
                          "Placeholder"
                        )}
                      </div>
                      <div className="recent-preview">
                        {(transcript.transcript_text || "").substring(0, 100)}...
                      </div>
                    </div>
                    <div className="recent-actions">
                      <button
                        className="btn-icon view-transcript"
                        title="View"
                        onClick={() => viewTranscript(transcript.id)}
                      >
                        👁️
                      </button>
                      <button
                        className="btn-icon edit-transcript"
                        title="Edit"
                        onClick={() => editTranscript(transcript.id)}
                      >
                        ✏️
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="recent-section">
            <h3>Recent SOAP Notes</h3>
            <div id="recentSoapNotesDashboard">
              {recentSoapNotes.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">📋</div>
                  <div className="empty-text">No SOAP notes yet</div>
                </div>
              ) : (
                recentSoapNotes.map((soap) => (
                  <div className="recent-item" data-id={soap.id} key={soap.id}>
                    <div className="recent-icon">📋</div>
                    <div className="recent-content">
                      <div className="recent-title">
                        SOAP Note -{" "}
                        {format.formatTimestamp(soap.created_at)}
                      </div>
                      <div className="recent-preview">
                        {soap.soapNote_text?.subjective
                          ? soap.soapNote_text.subjective.substring(0, 100) +
                            "..."
                          : "No content"}
                      </div>
                    </div>
                    <div className="recent-actions">
                      <button
                        className="btn-icon view-soap"
                        title="View"
                        onClick={() => viewSoapNote(soap.id)}
                      >
                        👁️
                      </button>
                      <button
                        className="btn-icon edit-soap"
                        title="Edit"
                        onClick={() => editSoapNote(soap.id)}
                      >
                        ✏️
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="recent-section">
            <h3>Recent Patient Encounters</h3>
            <div id="recentPatientEncountersDashboard">
              {recentPatientEncounters.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">🏥</div>
                  <div className="empty-text">No patient encounters yet</div>
                </div>
              ) : (
                recentPatientEncounters.map((encounter) => (
                  <div
                    className="recent-item"
                    data-id={encounter.id}
                    key={encounter.id}
                  >
                    <div className="recent-icon">🏥</div>
                    <div className="recent-content">
                      <div className="recent-title">
                        Patient Encounter -{" "}
                        {format.formatTimestamp(encounter.created_at)}
                      </div>
                      <div className="recent-preview">
                        {(encounter.name || "").substring(0, 100)}...
                      </div>
                    </div>
                    <div className="recent-actions">
                      <button
                        className="btn-icon view-encounter"
                        title="View"
                        onClick={() => viewPatientEncounter(encounter.id)}
                      >
                        👁️
                      </button>
                      <button
                        className="btn-icon edit-encounter"
                        title="Edit"
                        onClick={() => editPatientEncounter(encounter.id)}
                      >
                        ✏️
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div> */}
        <div
          className="tab-content"
          id="encounters-tab"
          style={{ display: activeTab === "encounters" ? "block" : "none" }}
        >
          <h3 className="mb-5">Recent Patient Encounters</h3>
          <div
            id="recentPatientEncounters"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: "20px",
              width: "100%",
              margin: "0 auto",
            }}
            className="responsive-grid"
          >
            {recentPatientEncounters.length === 0 ? (
              <div className="empty-state" style={{ gridColumn: "1 / -1" }}>
                <div className="empty-icon">🏥</div>
                <div className="empty-text">No patient encounters yet</div>
              </div>
            ) : (
              recentPatientEncounters.map((encounter) => (
                <div
                  className="encounter-card"
                  data-encounter-id={encounter.id}
                  key={encounter.id}
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
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow =
                      "0 4px 16px rgba(0,0,0,0.16)";
                    e.currentTarget.style.transform =
                      "translateY(-4px) scale(1.03)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow =
                      "0 2px 8px rgba(0,0,0,0.08)";
                    e.currentTarget.style.transform = "none";
                  }}
                  onClick={() => editPatientEncounter(encounter.id)}
                >
                  <div
                    className="recent-icon"
                    style={{ fontSize: "2rem", marginBottom: "8px" }}
                  >
                    🏥
                  </div>
                  <div
                    className="recent-title"
                    style={{ fontWeight: "bold", marginBottom: "6px" }}
                  >
                    {encounter.name || ""}
                  </div>
                  <div
                    className="recent-preview"
                    style={{
                      color: "#555",
                      marginBottom: "12px",
                      fontSize: "0.95em",
                    }}
                  >
                    {format.formatTimestamp(encounter.created_at)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div
          className="tab-content"
          id="soap-tab"
          style={{ display: activeTab === "soap" ? "block" : "none" }}
        >
          <h3>Recent SOAP Notes</h3>
          <div
            id="recentSoapNotes"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: "20px",
              width: "100%",
              margin: "0 auto",
            }}
            className="responsive-grid"
          >
            {recentSoapNotes.length === 0 ? (
              <div className="empty-state" style={{ gridColumn: "1 / -1" }}>
                <div className="empty-icon">📋</div>
                <div className="empty-text">No SOAP notes yet</div>
              </div>
            ) : (
              recentSoapNotes.map((soapNote) => (
                <div
                  className="soap-card"
                  data-soapnote-id={soapNote.id}
                  key={soapNote.id}
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
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow =
                      "0 4px 16px rgba(0,0,0,0.16)";
                    e.currentTarget.style.transform =
                      "translateY(-4px) scale(1.03)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow =
                      "0 2px 8px rgba(0,0,0,0.08)";
                    e.currentTarget.style.transform = "none";
                  }}
                  onClick={() => editSoapNote(soapNote.id)}
                >
                  <div
                    className="recent-icon"
                    style={{ fontSize: "2rem", marginBottom: "8px" }}
                  >
                    📋
                  </div>
                  <div
                    className="recent-title"
                    style={{ fontWeight: "bold", marginBottom: "6px" }}
                  >
                    {format.formatTimestamp(soapNote.created_at)}
                  </div>
                  <div
                    className="recent-preview"
                    style={{
                      color: "#555",
                      marginBottom: "12px",
                      fontSize: "0.95em",
                    }}
                  >
                    {soapNote.soapNote_text.soapNote.subjective
                      ? soapNote.soapNote_text.soapNote.subjective.substring(
                          0,
                          200
                        ) + "..."
                      : "No content"}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* <div className="dashboard-actions">
          <button
            id="viewTranscriptsBtn"
            onClick={() => switchTab("transcripts")}
          >
            View Transcripts
          </button>
          <button
            id="manageDotPhrasesBtn"
            onClick={() =>
              ui.showToast("Dot phrase management coming soon!", "info")
            }
          >
            Manage Dot Phrases
          </button>
          <button
            id="newTranscriptBtn"
            onClick={() =>
              ui.showToast("Recording feature coming soon!", "info")
            }
          >
            New Transcript
          </button>
          <button
            id="viewEncountersBtn"
            onClick={() => switchTab("encounters")}
          >
            View Patient Encounters
          </button>
          <button id="settingsBtn" onClick={openSettingsModal}>
            Settings
          </button>
          <button id="exportBtn" onClick={exportData}>
            Export
          </button>
        </div> */}
      </div>
    </>
  );
};

export default Dashboard;
