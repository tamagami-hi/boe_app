import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppBar from '../layout/AppBar.jsx';
import Skeleton from '@beonedge/shared/components/Skeleton.jsx';
import * as disclosureApi from '../services/disclosureApi.js';
import { DESTINATION_KIND } from '../navigation/routes.js';
import { openExternal } from '../utils/openExternal.js';
import { Mail, Phone, Clock, MapPin, ArrowLeft, ExternalLink, ChevronRight, Clock3 } from 'lucide-react';

export default function GrievanceRedressal() {
  const navigate = useNavigate();
  const [content, setContent] = useState(null);
  const [openError, setOpenError] = useState('');

  // Failure has to be visible: on native, a blocked or unhandled URL otherwise
  // produces a tap with no result at all.
  async function handleExternal(destination) {
    setOpenError('');
    const result = await openExternal(destination.url);
    if (!result.ok) setOpenError('We couldn\u2019t open that link. Please use the contact details below.');
  }

  useEffect(() => {
    let cancelled = false;
    disclosureApi.getGrievanceContent().then((data) => {
      if (!cancelled) setContent(data);
    });
    return () => { cancelled = true; };
  }, []);

  if (!content) {
    return (
      <>
        <AppBar title="Grievance Redressal" />
        <div className="apk-screen">
          <Skeleton variant="card" height={180} />
          <Skeleton variant="card" height={240} />
        </div>
      </>
    );
  }

  return (
    <>
      <AppBar title="Grievance Redressal" />
      <div className="apk-screen apk-grievance-screen">
        <div className="apk-grievance-header">
          <h1>{content.title}</h1>
          <p>{content.summary}</p>
        </div>

        {/* Steps */}
        <div className="be-card apk-grievance-steps">
          <div className="be-eyebrow">Escalation Process</div>
          <div className="apk-grievance-step-list">
            {content.steps.map((step, idx) => (
              <div key={idx} className="apk-grievance-step">
                <div className="apk-grievance-step-num">{step.step}</div>
                <div className="apk-grievance-step-body">
                  <div className="apk-grievance-step-title">{step.title}</div>
                  <p className="apk-grievance-step-desc">{step.description}</p>
                  <div className="apk-grievance-step-timeline">
                    <Clock3 size={12} strokeWidth={2} />
                    <span>{step.timeline}</span>
                  </div>
                  {/* One typed destination per step, classified at the service
                      edge: an internal route, an email, or an external portal.
                      Rendering used to key off whichever field name happened to
                      be present, which meant a step could supply any string and
                      choose the affordance itself. */}
                  {step.destination?.kind === DESTINATION_KIND.INTERNAL && step.actionLabel && (
                    <button
                      type="button"
                      className="apk-link apk-inline-link apk-mt-2"
                      onClick={() => navigate(step.destination.path)}
                    >
                      {step.actionLabel} <ChevronRight size={12} strokeWidth={2} />
                    </button>
                  )}
                  {step.destination?.kind === DESTINATION_KIND.EMAIL && (
                    <button
                      type="button"
                      className="apk-link apk-inline-link apk-mt-2"
                      onClick={() => handleExternal(step.destination)}
                    >
                      {step.contactEmail} <ExternalLink size={12} strokeWidth={2} />
                    </button>
                  )}
                  {step.destination?.kind === DESTINATION_KIND.EXTERNAL && (
                    <button
                      type="button"
                      className="apk-link apk-inline-link apk-mt-2"
                      onClick={() => handleExternal(step.destination)}
                    >
                      Visit portal <ExternalLink size={12} strokeWidth={2} />
                    </button>
                  )}
                  {/* A step whose destination was refused still shows its copy;
                      only the action disappears. The contact block below remains
                      a working route to support. */}
                  {step.destination?.kind === DESTINATION_KIND.UNSAFE && step.contactEmail && (
                    <span className="apk-grievance-step-desc">{step.contactEmail}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Timelines */}
        <div className="be-card apk-grievance-timelines">
          <div className="be-eyebrow">Committed Timelines</div>
          <div className="apk-grievance-timeline-grid">
            {content.timelines.map((t, idx) => (
              <div key={idx} className="apk-grievance-timeline-item">
                <div className="apk-grievance-timeline-label">{t.label}</div>
                <div className="apk-grievance-timeline-value">{t.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Contact */}
        <div className="be-card apk-grievance-contact">
          <div className="be-eyebrow">Grievance Officer</div>
          <div className="apk-grievance-contact-grid">
            <div className="apk-grievance-contact-item">
              <Mail size={16} strokeWidth={1.5} />
              <span>{content.contact.email}</span>
            </div>
            <div className="apk-grievance-contact-item">
              <Phone size={16} strokeWidth={1.5} />
              <span>{content.contact.phone}</span>
            </div>
            <div className="apk-grievance-contact-item">
              <Clock size={16} strokeWidth={1.5} />
              <span>{content.contact.hours}</span>
            </div>
          </div>
          <div className="apk-grievance-contact-item apk-contact-address">
            <MapPin size={16} strokeWidth={1.5} />
            <span className="apk-pre-line">{content.contact.address}</span>
          </div>
        </div>

        {openError && (
          <p className="be-disclosure" role="status">{openError}</p>
        )}

        <div className="apk-grievance-footer">
          <Link to="/app/explore" className="apk-back-link apk-inline-flex">
            <ArrowLeft size={16} strokeWidth={1.5} />
            <span>Back to strategies</span>
          </Link>
        </div>
      </div>
    </>
  );
}
