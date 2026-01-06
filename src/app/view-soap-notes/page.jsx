"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as api from "@/public/scripts/api.js";
import * as format from "@/public/scripts/format.js";
import Auth from "@/src/components/Auth.jsx";
import parseSoapNotes from "@/src/utils/parseSoapNotes";

// Pagination constants for SOAP notes queries
const SOAP_NOTES_PAGINATION = {
  limit: 100,
  offset: 0,
  sortBy: 'created_at',
  order: 'desc',
};

export default function ViewSoapNotes() {
  const router = useRouter();
  const [soapNotes, setSoapNotes] = useState([]);
  const [sortBy, setSortBy] = useState("created_at");

  useEffect(() => {
    const fetchSoapNotes = async () => {
      const jwt = api.getJWT();
      if (!jwt) {
        router.push("/login");
        return;
      }
      try {
        const queryParams = new URLSearchParams(SOAP_NOTES_PAGINATION).toString();
        const response = await fetch(`/api/soap-notes?${queryParams}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${jwt}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        });
        if (!response.ok) {
          router.push("/login");
          return;
        }
        const data = await response.json();
        const parsedSoapNotes = parseSoapNotes(data);
        setSoapNotes(parsedSoapNotes);
        console.log("Fetched SOAP notes:", parsedSoapNotes);
      } catch (error) {
        router.push("/login");
      }
    };
    fetchSoapNotes();
  }, [router]);

  const sortedSoapNotes = [...soapNotes].sort((a, b) => {
    if (sortBy === "created_at") {
      return new Date(b.created_at) - new Date(a.created_at);
    }
    if (sortBy === "updated_at") {
      return new Date(b.updated_at) - new Date(a.updated_at);
    }
    if (sortBy === "A-Z") {
      return (a.soapNote_text?.soapNote?.subjective || "").localeCompare(
        b.soapNote_text?.soapNote?.subjective || ""
      );
    }
    return 0;
  });

  const handleCardClick = (id) => {
    router.push(`/edit-soap-note?id=${id}`);
  };

  return (
    <>
      <Auth />
      <div className="max-w-8xl mx-auto p-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">
            View SOAP Notes ({soapNotes.length})
          </h1>
          <div className="flex items-center gap-2">
            <label
              htmlFor="sortBy"
              className="text-sm font-medium text-gray-700"
            >
              Sort By:
            </label>
            <select
              id="sortBy"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            >
              <option value="created_at">Date Created</option>
              <option value="updated_at">Date Updated</option>
              <option value="A-Z">A-Z</option>
            </select>
          </div>
        </div>
        <div
          id="allSoapNotes"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: "20px",
            width: "100%",
            margin: "0 auto",
          }}
          className="responsive-grid"
        >
          {sortedSoapNotes.length === 0 ? (
            <div className="empty-state" style={{ gridColumn: "1 / -1" }}>
              <div className="empty-icon">📋</div>
              <div className="empty-text">No SOAP notes found</div>
            </div>
          ) : (
            sortedSoapNotes.map((soapNote) => (
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
                onClick={() => handleCardClick(soapNote.id)}
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
                  {soapNote.soapNote_text?.soapNote?.subjective
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
    </>
  );
}
