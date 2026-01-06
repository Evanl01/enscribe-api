"use client";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useState, useRef, useEffect, Suspense } from "react";
import * as api from "@/public/scripts/api.js";
import * as ui from "@/public/scripts/ui.js";
import * as format from "@/public/scripts/format.js";
import PatientEncounterPreviewOverlay from "@/src/components/PatientEncounterPreviewOverlay";
import ExportDataAsFileMenu from "@/src/components/ExportDataAsFileMenu";
import id from "zod/v4/locales/id.cjs";
import Auth from "@/src/components/Auth.jsx";
import CopyToClipboard from '@/src/components/CopyToClipboard.jsx';
import parseSoapNotes from "@/src/utils/parseSoapNotes";

function EditSoapNoteInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const soapNoteIdRaw = searchParams.get("id");
  const soapNoteId = soapNoteIdRaw ? parseInt(soapNoteIdRaw, 10) : null;

  // State management
  const [patientEncounterId, setPatientEncounterId] = useState("");
  const [patientEncounterName, setPatientEncounterName] = useState("");
  const [transcript, setTranscript] = useState("");
  const [soapSubjective, setSoapSubjective] = useState("");
  const [soapObjective, setSoapObjective] = useState("");
  const [soapAssessment, setSoapAssessment] = useState("");
  const [soapPlan, setSoapPlan] = useState("");
  const [billingSuggestion, setBillingSuggestion] = useState("");
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioLoaded, setAudioLoaded] = useState(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioLoadingState, setAudioLoadingState] = useState("idle");
  const audioPlayerRef = useRef(null);

  const [isSaving, setIsSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [currentStatus, setCurrentStatus] = useState(null);

  // Fetch soap note and patient encounter data on mount
  useEffect(() => {
    if (!soapNoteId) return;
    const fetchData = async () => {
      try {
        // 1. Fetch soapNote by id
        const soapNoteRes = await fetch(`/api/soap-notes/${soapNoteId}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${api.getJWT()}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        });
        if (!soapNoteRes.ok) {
          throw new Error(
            `Failed to fetch SOAP note: ${soapNoteRes.statusText}`
          );
        }
        let data = await soapNoteRes.json();
        data = parseSoapNotes(data);
        if (!data) throw new Error("SOAP note not found");

        // 2. Set SOAP note fields
        const soapNoteText = data.soapNote_text;
        setSoapSubjective(soapNoteText?.soapNote?.subjective || "");
        setSoapObjective(soapNoteText?.soapNote?.objective || "");
        setSoapAssessment(soapNoteText?.soapNote?.assessment || "");
        setSoapPlan(soapNoteText?.soapNote?.plan || "");
        let billingSuggestionObj = soapNoteText?.billingSuggestion || {};
        let billingSuggestionText = format.cleanMarkdownText(
          "",
          billingSuggestionObj,
          0,
          "1.25em"
        );
        setBillingSuggestion(billingSuggestionText);

        // 3. Fetch patient encounter using soapNote.patientEncounter_id
        const patientEncounterId = data.patientEncounter_id;
        if (!patientEncounterId)
          throw new Error("Associated Patient Encounter not found");
        const patientEncounterRes = await fetch(
          `/api/patient-encounters/complete/${patientEncounterId}`,
          {
            headers: {
              Authorization: `Bearer ${api.getJWT()}`,
              "Content-Type": "application/json",
            },
            cache: "no-store",
          }
        );
        if (!patientEncounterRes.ok) {
          throw new Error(
            `Failed to fetch patient encounter: ${patientEncounterRes.statusText}`
          );
        }
        const patientEncounterDataRaw = await patientEncounterRes.json();
        const patientEncounterData = patientEncounterDataRaw.patientEncounter;
        setPatientEncounterName(patientEncounterData.name || "");
      } catch (error) {
        console.error("Error fetching SOAP note or patient encounter:", error);
        setErrorMessage(
          `Failed to load SOAP note or patient encounter: ${error.message}`
        );
        setPatientEncounterName("");
        setSoapSubjective("");
        setSoapObjective("");
        setSoapAssessment("");
        setSoapPlan("");
        setBillingSuggestion("");
      }
    };
    fetchData();
  }, [soapNoteId]);

  // Audio event handlers
  const handleAudioLoadedMetadata = () => {
    if (audioPlayerRef.current) {
      const duration = audioPlayerRef.current.duration;
      if (isFinite(duration) && duration > 0) {
        setAudioDuration(duration);
        setAudioLoaded(true);
        setAudioLoadingState("loaded");
      } else {
        setAudioDuration(recordingDuration || 0);
        setAudioLoaded(true);
        setAudioLoadingState("loaded");
      }
    }
  };

  const handleAudioTimeUpdate = () => {
    if (audioPlayerRef.current) {
      setAudioCurrentTime(audioPlayerRef.current.currentTime);
    }
  };

  const handleAudioEnded = () => {
    setAudioCurrentTime(0);
  };

  const handleAudioError = (e) => {
    setAudioLoadingState("error");
    setAudioLoaded(false);
    alert("Error loading audio file.");
  };

  // Audio control functions
  const playAudio = async () => {
    if (audioPlayerRef.current && audioLoaded) {
      try {
        await audioPlayerRef.current.play();
      } catch (error) {
        alert(`Error playing audio: ${error.message}`);
      }
    }
  };

  const pauseAudio = () => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
    }
  };

  const seekAudio = (time) => {
    if (audioPlayerRef.current && audioLoaded) {
      audioPlayerRef.current.currentTime = Math.min(
        time,
        audioDuration || recordingDuration || time
      );
      setAudioCurrentTime(audioPlayerRef.current.currentTime);
    }
  };

  // Save transcript and note
  const saveSoapNote = async () => {
    setIsSaving(true);
    const missingFields = [];
    if (!soapSubjective.trim()) missingFields.push("Subjective");
    if (!soapObjective.trim()) missingFields.push("Objective");
    if (!soapAssessment.trim()) missingFields.push("Assessment");
    if (!soapPlan.trim()) missingFields.push("Plan");
    if (!billingSuggestion.trim()) missingFields.push("Billing Suggestion");
    if (missingFields.length > 0) {
      alert("Required field(s): " + missingFields.join(", "));
      setIsSaving(false);
      return;
    }

    try {
      const soapNoteObject = {
        subjective: soapSubjective.replace(/\r?\n/g, "\n"),
        objective: soapObjective.replace(/\r?\n/g, "\n"),
        assessment: soapAssessment.replace(/\r?\n/g, "\n"),
        plan: soapPlan.replace(/\r?\n/g, "\n"),
      };

      const payload = {
        soapNote_text: {
          soapNote: soapNoteObject,
          billingSuggestion,
        },
      };
      console.log("Saving SOAP note:", payload);
      const response = await fetch(`/api/soap-notes/${soapNoteId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${api.getJWT()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
      });

      if (!response.ok) {
        let detailedError = `Failed to save patient encounter: ${response.status} ${response.statusText}`;
        try {
          const errorText = await response.text();
          if (errorText) {
            detailedError += `\nServer response: ${errorText}`;
          }
        } catch (e) {}
        alert(detailedError);
        setIsSaving(false);
        return;
      }
      setIsSaving(false);
      window.location.reload();
    } catch (error) {
      alert("Error saving data: " + error.message);
      setIsSaving(false);
    }
  };

  // Format duration helper
  const formatDuration = (seconds) => {
    if (!isFinite(seconds) || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <>
      <Auth />
      <div className="max-w-8xl mx-auto p-6">
        {/* Title row with Export button on right */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">Edit Soap Note</h1>
          <ExportDataAsFileMenu
            patientEncounterData={{ name: patientEncounterName }}
            transcriptData={null}
            soapNotesData={[
              {
                id: soapNoteId,

                soapNote_text: {
                  soapNote: {
                    subjective: soapSubjective,
                    objective: soapObjective,
                    assessment: soapAssessment,
                    plan: soapPlan,
                  },
                  billingSuggestion: billingSuggestion,
                },
              },
            ]}
          />
        </div>

        {/* Section 1: Edit SOAP Note */}
        <div className="border border-gray-200 rounded-lg">
          <button
            className="w-full p-4 text-left bg-gray-50 hover:bg-gray-100 flex justify-between items-center"
            onClick={() => {}}
            disabled={false}
          >
            <span className="text-lg font-semibold">1. Edit SOAP Note</span>
            <span className="text-xl">−</span>
          </button>
          <div className="p-6 border-t border-gray-200">
            {/* Associated Patient Encounter Name (non-editable) */}
            <div className="mb-6">
              <label className="block text-sm font-bold text-xl text-gray-700 mb-2">
                Associated Patient Encounter Name
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={patientEncounterName}
                  disabled
                  className="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-700 cursor-not-allowed"
                  style={{ minWidth: "12rem" }}
                />
              </div>
              <div className="mt-2 text-red-600 text-sm font-medium">
                This field is view-only. To change, go to{" "}
                <a
                  href={`/edit-patient-encounter?id=${patientEncounterId}`}
                  className="text-blue-600 underline text-sm font-medium"
                  style={{ whiteSpace: "nowrap" }}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Edit Patient Encounter
                </a>{" "}
                page.
              </div>
            </div>

            {errorMessage && (
              <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800">
                <div className="font-medium capitalize">Error</div>
                <div className="text-sm">{errorMessage}</div>
              </div>
            )}

            <div className="mb-6">
              <label className="block text-sm font-bold text-xl text-gray-700 mb-2">
                Subjective
              </label>
              <textarea
                value={soapSubjective}
                onChange={(e) => setSoapSubjective(e.target.value)}
                disabled={isSaving}
                className="w-full h-80 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 border-gray-300 bg-white resize-none"
                style={{ minHeight: "8rem" }}
                placeholder="Subjective notes will appear here..."
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <CopyToClipboard text={soapSubjective} label="Copy" placement="right" />
              </div>
            </div>
            <div className="mb-6">
              <label className="block text-sm font-bold text-xl text-gray-700 mb-2">
                Objective
              </label>
              <textarea
                value={soapObjective}
                onChange={(e) => setSoapObjective(e.target.value)}
                disabled={isSaving}
                className="w-full h-80 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 border-gray-300 bg-white resize-none"
                style={{ minHeight: "8rem" }}
                placeholder="Objective notes will appear here..."
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <CopyToClipboard text={soapObjective} label="Copy" placement="right" />
              </div>
            </div>
            <div className="mb-6">
              <label className="block text-sm font-bold text-xl text-gray-700 mb-2">
                Assessment
              </label>
              <textarea
                value={soapAssessment}
                onChange={(e) => setSoapAssessment(e.target.value)}
                disabled={isSaving}
                className="w-full h-50 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 border-gray-300 bg-white resize-none"
                style={{ minHeight: "8rem" }}
                placeholder="Assessment notes will appear here..."
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <CopyToClipboard text={soapAssessment} label="Copy" placement="right" />
              </div>
            </div>
            <div className="mb-6">
              <label className="block text-sm font-bold text-xl text-gray-700 mb-2">
                Plan
              </label>
              <textarea
                value={soapPlan}
                onChange={(e) => setSoapPlan(e.target.value)}
                disabled={isSaving}
                className="w-full h-50 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 border-gray-300 bg-white resize-none"
                style={{ minHeight: "8rem" }}
                placeholder="Plan notes will appear here..."
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <CopyToClipboard text={soapPlan} label="Copy" placement="right" />
              </div>
            </div>
            <div className="mb-6">
              <label className="block text-sm font-bold text-xl text-gray-700 mb-2">
                Billing Suggestion
              </label>
              <textarea
                value={billingSuggestion}
                onChange={(e) => setBillingSuggestion(e.target.value)}
                disabled={isSaving}
                className="w-full h-80 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 border-gray-300 bg-white resize-none"
                style={{ minHeight: "20rem" }}
                placeholder="Billing suggestion will appear here..."
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <CopyToClipboard text={billingSuggestion} label="Copy" placement="right" />
              </div>
            </div>
            <div className="flex flex-col items-end">
              <button
                onClick={() => setShowPreview(true)}
                disabled={isSaving}
                className={`bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-lg font-medium ${
                  isSaving ? "opacity-50 cursor-not-allowed" : ""
                }`}
              >
                Preview & Save
              </button>
              {errorMessage && (
                <div className="mt-3 text-red-600 text-sm text-right w-full">
                  {errorMessage}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <PatientEncounterPreviewOverlay
        isOpen={showPreview}
        onClose={() => setShowPreview(false)}
        soapSubjective={soapSubjective}
        setSoapSubjective={setSoapSubjective}
        soapObjective={soapObjective}
        setSoapObjective={setSoapObjective}
        soapAssessment={soapAssessment}
        setSoapAssessment={setSoapAssessment}
        soapPlan={soapPlan}
        setSoapPlan={setSoapPlan}
        billingSuggestion={billingSuggestion}
        setBillingSuggestion={setBillingSuggestion}
        patientEncounterName={patientEncounterName}
        setPatientEncounterName={setPatientEncounterName}
        onSave={saveSoapNote}
        isSaving={isSaving}
        errorMessage={errorMessage}
        sections={["soapNote", "billingSuggestion"]}
        isPatientEncounterNameEditable={false}
      />
    </>
  );
}

export default function EditSoapNote() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <EditSoapNoteInner />
    </Suspense>
  );
}
