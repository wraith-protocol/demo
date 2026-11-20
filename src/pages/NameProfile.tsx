import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getNameRecord, type NameRecord } from '@/lib/stellar/names';
import { EmptyState } from '@/components/EmptyState';
import { CopyButton } from '@/components/CopyButton';

interface SocialLink {
  label: string;
  href: string;
  value: string;
}

export default function NameProfile() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [record, setRecord] = useState<NameRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!name) return;

    const fetchRecord = async () => {
      setIsLoading(true);
      setError(false);
      try {
        const data = await getNameRecord(name);
        if (!data) {
          setError(true);
          setRecord(null);
        } else {
          setRecord(data);
          // Update document title
          document.title = `${name} — Wraith Name`;
          // Update meta tags
          updateMetaTags(name, data);
        }
      } catch {
        setError(true);
        setRecord(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchRecord();
  }, [name]);

  // Reset meta tags on unmount
  useEffect(() => {
    return () => {
      document.title = 'Wraith Demo — Stealth Address SDK';
      resetMetaTags();
    };
  }, []);

  const isExpired = record ? record.expires_at <= Math.floor(Date.now() / 1000) : false;

  const handleSendClick = () => {
    if (!record) return;
    const recipient = record.name.endsWith('.wraith') ? record.name : `${record.name}.wraith`;
    navigate(`/send?to=${encodeURIComponent(recipient)}`);
  };

  const socialLinks = getSocialLinks(record?.metadata ?? {});

  if (isLoading) {
    return (
      <section className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Wraith Names
          </span>
          <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
            Loading...
          </h1>
        </div>
      </section>
    );
  }

  if (error || !record) {
    return (
      <section className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Wraith Names
          </span>
          <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
            {name}
          </h1>
        </div>
        <EmptyState
          title="Name Not Found"
          description="This Wraith Name is not registered or has expired."
          primaryCTA={{
            label: 'Register a Name',
            onClick: () => navigate('/names'),
          }}
        />
      </section>
    );
  }

  if (isExpired) {
    return (
      <section className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Wraith Names
          </span>
          <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
            {name}
          </h1>
        </div>
        <EmptyState
          title="Name Expired"
          description="This Wraith Name has expired and is no longer active."
          primaryCTA={{
            label: 'Register a Name',
            onClick: () => navigate('/names'),
          }}
        />
      </section>
    );
  }

  const expiryDate = new Date(record.expires_at * 1000).toLocaleDateString();

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Wraith Names
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          {name}
        </h1>
      </div>

      <div className="flex flex-col gap-6">
        {/* Avatar */}
        {record.metadata.avatar_url && (
          <div className="flex justify-center">
            <img
              src={record.metadata.avatar_url}
              alt={`${name} avatar`}
              className="h-24 w-24 border border-outline-variant"
            />
          </div>
        )}

        {/* Description */}
        {record.metadata.description && (
          <div className="border border-outline-variant bg-surface-container p-4">
            <p className="font-body text-sm leading-relaxed text-on-surface-variant">
              {record.metadata.description}
            </p>
          </div>
        )}

        {/* Social Links */}
        {socialLinks.length > 0 && (
          <div className="flex flex-col gap-2">
            {socialLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-primary underline"
              >
                {link.label}: {link.value}
              </a>
            ))}
          </div>
        )}

        {/* Meta Address */}
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Meta Address
          </span>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate font-mono text-xs text-primary">{record.owner}</code>
            <CopyButton text={record.owner} />
          </div>
        </div>

        {/* Expiry */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Expires
          </span>
          <span className="font-mono text-xs text-on-surface-variant">{expiryDate}</span>
        </div>

        {/* Send CTA */}
        <button
          onClick={handleSendClick}
          className="h-12 w-full bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110"
        >
          Send to {name}
        </button>
      </div>
    </section>
  );
}

function updateMetaTags(name: string, record: NameRecord) {
  const description = record.metadata.description || `Send payments to ${name} on Wraith Protocol.`;
  const profileUrl = `${window.location.origin}/n/${encodeURIComponent(name)}`;

  const ogTitle = ensureMetaTag('property', 'og:title');
  ogTitle.content = `${name} — Wraith Name`;

  const ogDescription = ensureMetaTag('property', 'og:description');
  ogDescription.content = description;

  const ogImage = ensureMetaTag('property', 'og:image');
  ogImage.content = record.metadata.avatar_url || '/og-image.png';

  const ogUrl = ensureMetaTag('property', 'og:url');
  ogUrl.content = profileUrl;

  const twitterTitle = ensureMetaTag('name', 'twitter:title');
  twitterTitle.content = `${name} — Wraith Name`;

  const twitterDescription = ensureMetaTag('name', 'twitter:description');
  twitterDescription.content = description;

  const twitterImage = ensureMetaTag('name', 'twitter:image');
  twitterImage.content = record.metadata.avatar_url || '/og-image.png';
}

function resetMetaTags() {
  const defaults = {
    'og:title': 'Wraith Demo — Stealth Address SDK',
    'og:description':
      'Send and receive private payments on Horizen and Stellar using stealth addresses.',
    'og:image': '/og-image.png',
    'og:url': 'https://demo.usewraith.xyz',
    'twitter:title': 'Wraith Demo — Stealth Address SDK',
    'twitter:description':
      'Send and receive private payments on Horizen and Stellar using stealth addresses.',
    'twitter:image': '/og-image.png',
  };

  Object.entries(defaults).forEach(([property, content]) => {
    const meta = ensureMetaTag(property.startsWith('twitter:') ? 'name' : 'property', property);
    meta.content = content;
  });
}

function ensureMetaTag(attribute: 'name' | 'property', key: string) {
  const selector = `meta[${attribute}="${key}"]`;
  let meta = document.head.querySelector(selector) as HTMLMetaElement | null;

  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute(attribute, key);
    document.head.appendChild(meta);
  }

  return meta;
}

function getSocialLinks(metadata: NameRecord['metadata']): SocialLink[] {
  const links: SocialLink[] = [];

  if (metadata.twitter_handle) {
    const handle = metadata.twitter_handle.replace(/^@/, '');
    links.push({
      label: 'Twitter',
      href: `https://x.com/${handle}`,
      value: metadata.twitter_handle,
    });
  }

  const recordSocials = (
    metadata as Record<string, string | undefined> & {
      socials?: Record<string, string>;
    }
  ).socials;

  if (recordSocials) {
    Object.entries(recordSocials).forEach(([platform, value]) => {
      if (!value) return;
      const normalized = value.startsWith('http') ? value : `https://${value}`;
      links.push({
        label: platform.charAt(0).toUpperCase() + platform.slice(1),
        href: normalized,
        value: value.replace(/^https?:\/\//, ''),
      });
    });
  }

  return links;
}
