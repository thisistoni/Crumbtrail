use crate::{
    models::{
        Annotation, AnnotationKind, ExportFormat, ExportRequest, ExportResult, NormalizedRect,
        ProjectManifest, ReportTheme,
    },
    storage::{StorageError, StorageService},
};
use ab_glyph::{FontArc, PxScale};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{
    codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage, GenericImageView, ImageFormat,
    Rgba,
};
use imageproc::{
    drawing::{
        draw_filled_circle_mut, draw_hollow_circle_mut, draw_hollow_rect_mut,
        draw_line_segment_mut, draw_text_mut,
    },
    rect::Rect,
};
use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    process::{Command, ExitStatus},
    sync::OnceLock,
    thread,
    time::{Duration, Instant, SystemTime},
};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum ExportError {
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Image error: {0}")]
    Image(#[from] image::ImageError),
    #[error("Microsoft Edge could not be found; HTML export is still available")]
    EdgeUnavailable,
    #[error("PDF rendering failed: {0}")]
    Pdf(String),
}

pub type ExportResultValue<T> = Result<T, ExportError>;

const PDF_IMAGE_MAX_WIDTH: u32 = 1600;
const PDF_IMAGE_JPEG_QUALITY: u8 = 82;

#[derive(Clone, Copy)]
enum ReportImageMode {
    Png,
    PdfJpeg,
}

pub fn export(
    storage: &StorageService,
    request: &ExportRequest,
) -> ExportResultValue<ExportResult> {
    match request.format {
        ExportFormat::Html => export_html(storage, request),
        ExportFormat::Pdf => export_pdf(storage, request),
        ExportFormat::Images => export_images(storage, request),
    }
}

fn export_html(
    storage: &StorageService,
    request: &ExportRequest,
) -> ExportResultValue<ExportResult> {
    let destination = PathBuf::from(&request.destination);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    let (html, warnings) = render_html(storage, &request.project)?;
    fs::write(&destination, html)?;
    Ok(ExportResult {
        destination: destination.to_string_lossy().to_string(),
        files_written: 1,
        warnings,
    })
}

fn export_pdf(
    storage: &StorageService,
    request: &ExportRequest,
) -> ExportResultValue<ExportResult> {
    let destination = PathBuf::from(&request.destination);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    let edge = find_edge().ok_or(ExportError::EdgeUnavailable)?;
    let export_root = std::env::temp_dir().join(format!("crumbtrail-pdf-{}", Uuid::new_v4()));
    fs::create_dir_all(&export_root)?;
    let html_path = export_root.join("report.html");
    let profile_path = export_root.join("edge-profile");
    let (html, mut warnings) =
        render_html_with_mode(storage, &request.project, ReportImageMode::PdfJpeg)?;
    fs::write(&html_path, html)?;

    if destination.exists() {
        fs::remove_file(&destination)?;
    }

    let file_url = format!("file:///{}", html_path.to_string_lossy().replace('\\', "/"));
    let output = Command::new(edge)
        .arg("--headless=new")
        .arg("--disable-gpu")
        .arg("--no-first-run")
        .arg("--no-pdf-header-footer")
        .arg(format!(
            "--user-data-dir={}",
            profile_path.to_string_lossy()
        ))
        .arg(format!("--print-to-pdf={}", destination.to_string_lossy()))
        .arg(file_url)
        .output()?;

    let render_result = wait_for_pdf(&destination, output.status, &output.stderr);
    let _ = fs::remove_dir_all(&export_root);
    render_result?;
    warnings.push("PDF is rendered locally with the installed Microsoft Edge engine.".into());
    Ok(ExportResult {
        destination: destination.to_string_lossy().to_string(),
        files_written: 1,
        warnings,
    })
}

fn wait_for_pdf(destination: &Path, status: ExitStatus, stderr: &[u8]) -> ExportResultValue<()> {
    if !status.success() {
        return Err(ExportError::Pdf(renderer_message(status, stderr)));
    }

    let deadline = Instant::now() + Duration::from_secs(60);
    let mut previous: Option<(u64, Option<SystemTime>)> = None;
    let mut stable_samples = 0;
    while Instant::now() < deadline {
        if let Ok(metadata) = fs::metadata(destination) {
            let fingerprint = (metadata.len(), metadata.modified().ok());
            if metadata.len() > 8 && previous == Some(fingerprint) {
                stable_samples += 1;
                if stable_samples >= 4 {
                    let bytes = fs::read(destination)?;
                    if is_complete_pdf(&bytes) {
                        return Ok(());
                    }
                }
            } else {
                stable_samples = 0;
                previous = Some(fingerprint);
            }
        }
        thread::sleep(Duration::from_millis(100));
    }

    Err(ExportError::Pdf(format!(
        "renderer did not produce a complete PDF within 60 seconds ({})",
        renderer_message(status, stderr)
    )))
}

fn is_complete_pdf(bytes: &[u8]) -> bool {
    bytes.starts_with(b"%PDF-")
        && bytes[bytes.len().saturating_sub(1024)..]
            .windows(5)
            .any(|window| window == b"%%EOF")
}

fn renderer_message(status: ExitStatus, stderr: &[u8]) -> String {
    let detail = String::from_utf8_lossy(stderr).trim().to_string();
    if detail.is_empty() {
        format!("renderer exited with {status}")
    } else {
        format!(
            "renderer exited with {status}: {}",
            detail.chars().take(500).collect::<String>()
        )
    }
}

fn export_images(
    storage: &StorageService,
    request: &ExportRequest,
) -> ExportResultValue<ExportResult> {
    let destination = PathBuf::from(&request.destination);
    fs::create_dir_all(&destination)?;
    let mut written = 0;
    let mut warnings = Vec::new();

    for (index, step) in request
        .project
        .steps
        .iter()
        .filter(|step| step.included)
        .enumerate()
    {
        let Some(asset) = step.media.selected_asset() else {
            warnings.push(format!(
                "Step {} has no screenshot and was skipped.",
                index + 1
            ));
            continue;
        };
        let bytes = storage.read_asset(&request.project.id, asset)?;
        let base_name = format!("{:03}-{}", index + 1, slug(&step.instruction));
        if request.include_annotated_images {
            let rendered = render_step_png(&bytes, &step.annotations, step.focus_zoom)?;
            fs::write(destination.join(format!("{base_name}.png")), rendered)?;
            written += 1;
        }
        if request.include_raw_images {
            fs::write(destination.join(format!("{base_name}-raw.png")), bytes)?;
            written += 1;
        }
    }

    Ok(ExportResult {
        destination: destination.to_string_lossy().to_string(),
        files_written: written,
        warnings,
    })
}

pub fn render_html(
    storage: &StorageService,
    project: &ProjectManifest,
) -> ExportResultValue<(String, Vec<String>)> {
    render_html_with_mode(storage, project, ReportImageMode::Png)
}

fn render_html_with_mode(
    storage: &StorageService,
    project: &ProjectManifest,
    image_mode: ReportImageMode,
) -> ExportResultValue<(String, Vec<String>)> {
    let mut steps = String::new();
    let mut warnings = Vec::new();
    let accent = sanitize_color(&project.theme.accent);
    let german = project.theme.report_locale.eq_ignore_ascii_case("de");
    let included_step_count = project.steps.iter().filter(|step| step.included).count();
    let screenshot_alt = if german {
        "Screenshot für Schritt"
    } else {
        "Screenshot for step"
    };
    let screenshot_unavailable = if german {
        "Screenshot nicht verfügbar"
    } else {
        "Screenshot unavailable"
    };
    let no_screenshot = if german {
        "Kein Screenshot"
    } else {
        "No screenshot"
    };

    for (index, step) in project
        .steps
        .iter()
        .filter(|step| step.included)
        .enumerate()
    {
        let image = match step.media.selected_asset() {
            Some(asset) => match storage.read_asset(&project.id, asset) {
                Ok(bytes) => match render_report_image(
                    &bytes,
                    &step.annotations,
                    step.focus_zoom,
                    image_mode,
                ) {
                    Ok((mime, rendered)) => format!(
                        "<img src=\"data:{mime};base64,{}\" alt=\"{} {}\">",
                        STANDARD.encode(rendered),
                        screenshot_alt,
                        index + 1
                    ),
                    Err(error) => {
                        warnings.push(format!(
                            "Step {} image could not be rendered: {error}",
                            index + 1
                        ));
                        format!("<div class=\"missing\">{screenshot_unavailable}</div>")
                    }
                },
                Err(error) => {
                    warnings.push(format!("Step {} image is missing: {error}", index + 1));
                    format!("<div class=\"missing\">{screenshot_unavailable}</div>")
                }
            },
            None => format!("<div class=\"missing\">{no_screenshot}</div>"),
        };
        let application = if project.theme.show_application_names {
            step.application
                .as_ref()
                .filter(|value| !value.is_empty())
                .map(|value| format!("<span>{}</span>", escape(value)))
                .unwrap_or_default()
        } else {
            String::new()
        };
        let timestamp = if project.theme.show_timestamps {
            format!("<time>{}</time>", escape(&step.created_at))
        } else {
            String::new()
        };
        let notes = if step.notes.trim().is_empty() {
            String::new()
        } else {
            format!("<p class=\"notes\">{}</p>", escape(&step.notes))
        };
        let marker = step
            .application_icon_asset
            .as_deref()
            .and_then(|asset| storage.read_asset(&project.id, asset).ok())
            .map(|bytes| {
                let application_name = step.application.as_deref().unwrap_or_default();
                format!(
                    "<div class=\"step-marker\"><img src=\"data:image/png;base64,{}\" alt=\"{}\"><span>{}</span></div>",
                    STANDARD.encode(bytes),
                    escape(application_name),
                    index + 1,
                )
            })
            .unwrap_or_else(|| format!("<div class=\"step-number\">{}</div>", index + 1));
        steps.push_str(&format!(
            "<li class=\"step\">{}<article><div class=\"meta\">{}{}</div><h2>{}</h2>{}<figure>{}</figure></article></li>",
            marker,
            application,
            timestamp,
            escape(&step.instruction),
            notes,
            image,
        ));
    }

    let class = match project.theme.preset {
        ReportTheme::CrumbtrailLight => "theme-light",
        ReportTheme::CrumbtrailDark => "theme-dark",
        ReportTheme::CleanPrint => "theme-light",
    };
    let font_class = match project.theme.typography {
        crate::models::TypographyPreset::Modern => "font-modern",
        crate::models::TypographyPreset::Editorial => "font-editorial",
        crate::models::TypographyPreset::Compact => "font-compact",
    };
    let logo = match project.theme.logo_asset.as_deref() {
        Some(asset) => storage
            .read_asset(&project.id, asset)
            .ok()
            .and_then(|bytes| render_annotated_png(&bytes, &[]).ok())
            .map(|bytes| {
                format!(
                    "<img class=\"logo\" src=\"data:image/png;base64,{}\" alt=\"Report logo\">",
                    STANDARD.encode(bytes)
                )
            })
            .unwrap_or_default(),
        None => String::new(),
    };
    let empty = if steps.is_empty() {
        if german {
            "<p class=\"empty\">Dieser Leitfaden enthält keine Schritte.</p>"
        } else {
            "<p class=\"empty\">This guide has no included steps.</p>"
        }
    } else {
        ""
    };
    let footer = if project.theme.show_crumbtrail_branding {
        let text = if german {
            "Erstellt mit Crumbtrail"
        } else {
            "Created with Crumbtrail"
        };
        let brand_mark = STANDARD.encode(include_bytes!("../icons/64x64.png"));
        format!(
            r#"<footer><img class="crumbtrail-mark" src="data:image/png;base64,{brand_mark}" alt=""><span>{text}</span></footer>"#
        )
    } else {
        String::new()
    };
    let lang = if german { "de" } else { "en" };
    let description = if project.description.trim().is_empty() {
        String::new()
    } else {
        format!(
            "<p class=\"subtitle\">{}</p>",
            escape(project.description.trim())
        )
    };
    let author = if project.author.trim().is_empty() {
        String::new()
    } else {
        let label = if german { "Von" } else { "By" };
        format!(
            "<span class=\"author\">{label} {}</span>",
            escape(project.author.trim())
        )
    };
    let step_count = if german {
        format!(
            "{} {}",
            included_step_count,
            if included_step_count == 1 {
                "Schritt"
            } else {
                "Schritte"
            }
        )
    } else {
        format!(
            "{} {}",
            included_step_count,
            if included_step_count == 1 {
                "step"
            } else {
                "steps"
            }
        )
    };
    let html = format!(
        r#"<!doctype html>
<html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title><style>
:root{{--accent:{accent};--canvas:#e9e6de;--paper:#fbfaf7;--ink:#25231f;--muted:#726e66;--line:#dedad1;--panel:#fff;--soft:#f1eee7;}}
*{{box-sizing:border-box}}html{{background:var(--canvas)}}body{{margin:0;background:var(--canvas);color:var(--ink);font:16px/1.55 "Segoe UI",system-ui,sans-serif}}
.theme-dark{{--canvas:#0f0f0e;--paper:#171714;--ink:#f4f0e8;--muted:#aaa49a;--line:#39362f;--panel:#211f1a;--soft:#1d1c18}}
.font-editorial{{font-family:Georgia,"Times New Roman",serif}}.font-compact{{font-size:14px;line-height:1.4}}
.page{{width:min(1040px,calc(100% - 48px));min-height:100vh;margin:32px auto;padding:72px 64px;background:var(--paper);box-shadow:0 24px 70px rgba(35,31,22,.12)}}header{{padding-bottom:34px;border-bottom:3px solid var(--accent)}}
.logo{{display:block;max-width:180px;max-height:60px;object-fit:contain;margin-bottom:24px}}h1{{max-width:820px;font-size:44px;line-height:1.06;letter-spacing:-.04em;margin:0}}.subtitle{{max-width:720px;margin:18px 0 0;color:var(--muted);font-size:18px;line-height:1.55}}
.report-meta{{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:24px;color:var(--muted);font-size:13px;font-weight:600;letter-spacing:.02em}}.author{{padding-left:18px;border-left:1px solid var(--line)}}ol{{list-style:none;padding:0;margin:56px 0 0;display:grid;gap:52px}}.step{{display:grid;grid-template-columns:44px minmax(0,1fr);gap:22px;break-inside:avoid}}.step article{{min-width:0}}
.step-number,.step-marker{{width:36px;height:36px;display:grid;place-items:center;font-weight:700}}.step-number{{border-radius:999px;background:#fff;color:#25231f;border:1px solid #dedad1;box-shadow:0 1px 3px rgba(20,17,10,.12)}}.step-marker{{position:relative;border-radius:10px;background:var(--panel);border:1px solid var(--line)}}.step-marker img{{width:26px;height:26px;object-fit:contain}}.step-marker span{{position:absolute;right:-5px;bottom:-5px;min-width:17px;height:17px;padding:0 4px;border-radius:999px;display:grid;place-items:center;background:#fff;color:#25231f;border:2px solid var(--paper);box-shadow:0 0 0 1px var(--line);font-size:10px;line-height:1}}
h2{{font-size:24px;line-height:1.25;letter-spacing:-.015em;margin:4px 0 10px}}.meta{{display:flex;flex-wrap:wrap;gap:8px 14px;color:var(--muted);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.065em}}
.notes{{max-width:760px;margin:0 0 18px;color:var(--muted)}}figure{{margin:20px 0 0;background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:0 14px 40px rgba(20,17,10,.08)}}figure img{{display:block;width:100%;height:auto;max-height:720px;object-fit:contain;background:var(--soft)}}
.missing,.empty{{padding:48px;text-align:center;color:var(--muted)}}footer{{display:flex;align-items:center;gap:9px;margin-top:56px;border-top:1px solid var(--line);padding-top:24px;color:var(--muted);font-size:13px}}.crumbtrail-mark{{width:24px;height:24px;flex:none;object-fit:contain}}
@media(max-width:700px){{.page{{width:100%;margin:0;padding:38px 20px;box-shadow:none}}h1{{font-size:34px}}.author{{padding-left:0;border-left:0}}.step{{grid-template-columns:34px minmax(0,1fr);gap:12px}}.step-number,.step-marker{{width:30px;height:30px}}.step-marker img{{width:22px;height:22px}}}}
@media print{{@page{{size:A4 portrait;margin:0;background:var(--paper)}}html,body{{min-height:100%;background:var(--paper)!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}body::before{{content:"";position:fixed;inset:0;background:var(--paper);z-index:-1}}.page{{width:auto;min-height:0;margin:0;padding:15mm 14mm 14mm;box-shadow:none}}header{{padding-bottom:8mm;break-after:avoid-page}}.logo{{max-height:16mm;margin-bottom:6mm}}h1{{font-size:34px}}.subtitle{{margin-top:4mm;font-size:15px}}.report-meta{{margin-top:5mm}}ol{{display:block;margin:11mm 0 0}}.step{{grid-template-columns:10mm minmax(0,1fr);gap:5mm;break-inside:avoid-page;page-break-inside:avoid;margin:0 0 13mm}}.step+.step{{break-before:page;page-break-before:always;padding-top:15mm}}.step:last-child{{margin-bottom:0}}h2{{font-size:20px;margin-top:1mm}}.notes{{margin-bottom:4mm}}figure{{margin-top:4mm;border-radius:3mm;box-shadow:none;break-inside:avoid-page}}figure img{{max-height:210mm}}footer{{margin-top:14mm;padding-top:5mm;break-inside:avoid-page}}}}
</style></head><body class="{class} {font_class}"><main class="page"><header>{logo}<h1>{title}</h1>{description}<div class="report-meta"><span>{step_count}</span>{author}</div></header>{empty}<ol>{steps}</ol>{footer}</main></body></html>"#,
        title = escape(&project.title),
    );
    Ok((html, warnings))
}

pub fn render_annotated_png(
    bytes: &[u8],
    annotations: &[Annotation],
) -> ExportResultValue<Vec<u8>> {
    render_step_png(bytes, annotations, None)
}

fn render_step_png(
    bytes: &[u8],
    annotations: &[Annotation],
    focus_zoom: Option<NormalizedRect>,
) -> ExportResultValue<Vec<u8>> {
    let image = render_step_image(bytes, annotations, focus_zoom)?;
    let mut output = Cursor::new(Vec::new());
    image.write_to(&mut output, ImageFormat::Png)?;
    Ok(output.into_inner())
}

fn render_report_image(
    bytes: &[u8],
    annotations: &[Annotation],
    focus_zoom: Option<NormalizedRect>,
    mode: ReportImageMode,
) -> ExportResultValue<(&'static str, Vec<u8>)> {
    match mode {
        ReportImageMode::Png => Ok((
            "image/png",
            render_step_png(bytes, annotations, focus_zoom)?,
        )),
        ReportImageMode::PdfJpeg => Ok((
            "image/jpeg",
            render_step_pdf_jpeg(bytes, annotations, focus_zoom)?,
        )),
    }
}

fn render_step_pdf_jpeg(
    bytes: &[u8],
    annotations: &[Annotation],
    focus_zoom: Option<NormalizedRect>,
) -> ExportResultValue<Vec<u8>> {
    let image = render_step_image(bytes, annotations, focus_zoom)?;
    let (width, height) = image.dimensions();
    let image = if width > PDF_IMAGE_MAX_WIDTH {
        let target_height =
            ((height as u64 * PDF_IMAGE_MAX_WIDTH as u64) / width as u64).max(1) as u32;
        image.resize_exact(PDF_IMAGE_MAX_WIDTH, target_height, FilterType::Lanczos3)
    } else {
        image
    };
    let mut output = Vec::new();
    JpegEncoder::new_with_quality(&mut output, PDF_IMAGE_JPEG_QUALITY).encode_image(&image)?;
    Ok(output)
}

fn render_step_image(
    bytes: &[u8],
    annotations: &[Annotation],
    focus_zoom: Option<NormalizedRect>,
) -> ExportResultValue<DynamicImage> {
    let original = image::load_from_memory(bytes)?;
    let crop = annotations
        .iter()
        .rev()
        .find(|item| item.kind == AnnotationKind::Crop)
        .map(|item| item.rect.clamped())
        .or_else(|| focus_zoom.map(NormalizedRect::clamped));
    let mut image = if let Some(crop) = crop {
        let (width, height) = original.dimensions();
        let x = (crop.x * width as f64).round() as u32;
        let y = (crop.y * height as f64).round() as u32;
        let w = (crop.width * width as f64).round().max(1.0) as u32;
        let h = (crop.height * height as f64).round().max(1.0) as u32;
        original.crop_imm(
            x.min(width.saturating_sub(1)),
            y.min(height.saturating_sub(1)),
            w.min(width - x.min(width.saturating_sub(1))),
            h.min(height - y.min(height.saturating_sub(1))),
        )
    } else {
        original
    };
    let crop = crop.unwrap_or(NormalizedRect {
        x: 0.0,
        y: 0.0,
        width: 1.0,
        height: 1.0,
    });

    for annotation in annotations
        .iter()
        .filter(|item| item.kind == AnnotationKind::Blur)
    {
        let rect = remap(annotation.rect, crop);
        pixelate(&mut image, rect);
    }
    let mut overlays = annotations
        .iter()
        .filter(|item| !matches!(item.kind, AnnotationKind::Blur | AnnotationKind::Crop))
        .collect::<Vec<_>>();
    overlays.sort_by_key(|item| item.z_index);
    for annotation in overlays {
        draw_annotation(&mut image, annotation, remap(annotation.rect, crop));
    }

    Ok(image)
}

fn draw_annotation(image: &mut DynamicImage, annotation: &Annotation, rect: NormalizedRect) {
    let (width, height) = image.dimensions();
    let x = (rect.x * width as f64).round() as i32;
    let y = (rect.y * height as f64).round() as i32;
    let w = (rect.width * width as f64).round().max(1.0) as u32;
    let h = (rect.height * height as f64).round().max(1.0) as u32;
    let mut color = parse_color(&annotation.color);
    color[3] = (annotation.opacity.clamp(0.0, 1.0) * 255.0).round() as u8;
    let stroke = annotation.stroke_width.round().clamp(1.0, 12.0) as i32;
    match annotation.kind {
        AnnotationKind::ClickMarker => {
            let center = (x + w as i32 / 2, y + h as i32 / 2);
            let radius = ((annotation.marker_size * width as f64 / 1440.0) / 2.0)
                .round()
                .clamp(6.0, 30.0) as i32;
            draw_filled_circle_mut(
                image,
                center,
                radius,
                Rgba([
                    color[0],
                    color[1],
                    color[2],
                    (72.0 * annotation.opacity.clamp(0.0, 1.0)) as u8,
                ]),
            );
            for offset in 0..stroke {
                draw_hollow_circle_mut(image, center, radius - offset, color);
            }
        }
        AnnotationKind::ElementOutline | AnnotationKind::Rectangle => {
            if annotation.rotation.abs() < f64::EPSILON {
                for offset in 0..stroke {
                    let rw = w.saturating_sub((offset * 2) as u32).max(1);
                    let rh = h.saturating_sub((offset * 2) as u32).max(1);
                    draw_hollow_rect_mut(
                        image,
                        Rect::at(x + offset, y + offset).of_size(rw, rh),
                        color,
                    );
                }
            } else {
                let center = (x as f32 + w as f32 / 2.0, y as f32 + h as f32 / 2.0);
                let corners = [
                    rotate_point((x as f32, y as f32), center, annotation.rotation),
                    rotate_point(
                        ((x + w as i32) as f32, y as f32),
                        center,
                        annotation.rotation,
                    ),
                    rotate_point(
                        ((x + w as i32) as f32, (y + h as i32) as f32),
                        center,
                        annotation.rotation,
                    ),
                    rotate_point(
                        (x as f32, (y + h as i32) as f32),
                        center,
                        annotation.rotation,
                    ),
                ];
                for index in 0..4 {
                    draw_thick_line(
                        image,
                        corners[index],
                        corners[(index + 1) % 4],
                        color,
                        stroke,
                    );
                }
            }
        }
        AnnotationKind::Arrow => {
            let center = (x as f32 + w as f32 / 2.0, y as f32 + h as f32 / 2.0);
            let start = rotate_point((x as f32, center.1), center, annotation.rotation);
            let end = rotate_point(
                ((x + w as i32) as f32, center.1),
                center,
                annotation.rotation,
            );
            draw_thick_line(image, start, end, color, stroke);
            let dx = end.0 - start.0;
            let dy = end.1 - start.1;
            let length = (dx * dx + dy * dy).sqrt().max(1.0);
            let direction = (dx / length, dy / length);
            let normal = (-direction.1, direction.0);
            let head = (12.0 + stroke as f32 * 2.0).min(length * 0.45);
            let first = (
                end.0 - direction.0 * head + normal.0 * head * 0.55,
                end.1 - direction.1 * head + normal.1 * head * 0.55,
            );
            let second = (
                end.0 - direction.0 * head - normal.0 * head * 0.55,
                end.1 - direction.1 * head - normal.1 * head * 0.55,
            );
            draw_thick_line(image, end, first, color, stroke);
            draw_thick_line(image, end, second, color, stroke);
        }
        AnnotationKind::Text => {
            if let (Some(label), Some(font)) = (annotation.label.as_deref(), system_font()) {
                draw_text_mut(
                    image,
                    color,
                    x,
                    y,
                    PxScale::from(
                        (annotation.marker_size as f32 * width as f32 / 1440.0).clamp(10.0, 72.0),
                    ),
                    font,
                    label,
                );
            }
        }
        AnnotationKind::Blur | AnnotationKind::Crop => {}
    }
}

fn rotate_point(point: (f32, f32), center: (f32, f32), degrees: f64) -> (f32, f32) {
    let radians = degrees.to_radians() as f32;
    let (sin, cos) = radians.sin_cos();
    let x = point.0 - center.0;
    let y = point.1 - center.1;
    (center.0 + x * cos - y * sin, center.1 + x * sin + y * cos)
}

fn draw_thick_line(
    image: &mut DynamicImage,
    start: (f32, f32),
    end: (f32, f32),
    color: Rgba<u8>,
    stroke: i32,
) {
    let dx = end.0 - start.0;
    let dy = end.1 - start.1;
    let length = (dx * dx + dy * dy).sqrt().max(1.0);
    let normal = (-dy / length, dx / length);
    let half = (stroke - 1) as f32 / 2.0;
    for offset in 0..stroke {
        let distance = offset as f32 - half;
        draw_line_segment_mut(
            image,
            (start.0 + normal.0 * distance, start.1 + normal.1 * distance),
            (end.0 + normal.0 * distance, end.1 + normal.1 * distance),
            color,
        );
    }
}

fn pixelate(image: &mut DynamicImage, rect: NormalizedRect) {
    let (width, height) = image.dimensions();
    let x = (rect.x * width as f64)
        .round()
        .clamp(0.0, width.saturating_sub(1) as f64) as u32;
    let y = (rect.y * height as f64)
        .round()
        .clamp(0.0, height.saturating_sub(1) as f64) as u32;
    let w = ((rect.width * width as f64).round() as u32)
        .max(1)
        .min(width - x);
    let h = ((rect.height * height as f64).round() as u32)
        .max(1)
        .min(height - y);
    let region = image.crop_imm(x, y, w, h);
    let tiny = region.resize_exact(
        (w / 18).max(1),
        (h / 18).max(1),
        image::imageops::FilterType::Nearest,
    );
    let pixelated = tiny.resize_exact(w, h, image::imageops::FilterType::Nearest);
    image::imageops::overlay(image, &pixelated, x as i64, y as i64);
}

fn remap(rect: NormalizedRect, crop: NormalizedRect) -> NormalizedRect {
    if crop.width <= 0.0 || crop.height <= 0.0 {
        return NormalizedRect::default();
    }
    NormalizedRect {
        x: (rect.x - crop.x) / crop.width,
        y: (rect.y - crop.y) / crop.height,
        width: rect.width / crop.width,
        height: rect.height / crop.height,
    }
    .clamped()
}

fn parse_color(value: &str) -> Rgba<u8> {
    let value = value.trim().trim_start_matches('#');
    if value.len() == 6 {
        if let Ok(rgb) = u32::from_str_radix(value, 16) {
            return Rgba([
                ((rgb >> 16) & 0xff) as u8,
                ((rgb >> 8) & 0xff) as u8,
                (rgb & 0xff) as u8,
                255,
            ]);
        }
    }
    Rgba([233, 162, 59, 255])
}

fn sanitize_color(value: &str) -> String {
    let value = value.trim();
    if value.len() == 7
        && value.starts_with('#')
        && value[1..]
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        value.to_string()
    } else {
        "#E9A23B".to_string()
    }
}

fn escape(value: &str) -> String {
    html_escape::encode_safe(value).to_string()
}

fn slug(value: &str) -> String {
    let mut value_out = String::new();
    let mut separator = false;
    for character in value.to_lowercase().chars() {
        if character.is_ascii_alphanumeric() {
            value_out.push(character);
            separator = false;
        } else if !separator && !value_out.is_empty() {
            value_out.push('-');
            separator = true;
        }
    }
    let trimmed = value_out
        .trim_matches('-')
        .chars()
        .take(64)
        .collect::<String>();
    if trimmed.is_empty() {
        "step".into()
    } else {
        trimmed
    }
}

fn find_edge() -> Option<PathBuf> {
    let candidates = [
        std::env::var_os("PROGRAMFILES(X86)").map(PathBuf::from),
        std::env::var_os("PROGRAMFILES").map(PathBuf::from),
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from),
    ];
    candidates
        .into_iter()
        .flatten()
        .map(|root| root.join("Microsoft/Edge/Application/msedge.exe"))
        .find(|path| path.exists())
}

fn system_font() -> Option<&'static FontArc> {
    static FONT: OnceLock<Option<FontArc>> = OnceLock::new();
    FONT.get_or_init(|| {
        let windir = std::env::var_os("WINDIR").map(PathBuf::from)?;
        let bytes = fs::read(windir.join("Fonts/segoeui.ttf")).ok()?;
        FontArc::try_from_vec(bytes).ok()
    })
    .as_ref()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ExportFormat, Step};
    use image::{ImageBuffer, RgbaImage};

    #[test]
    fn escapes_report_content_and_rejects_css_injection() {
        assert_eq!(escape("<script>&"), "&lt;script&gt;&amp;");
        assert_eq!(sanitize_color("red;display:none"), "#E9A23B");
    }

    #[test]
    fn recognizes_only_complete_pdf_bytes() {
        assert!(is_complete_pdf(b"%PDF-1.4\nbody\n%%EOF\n"));
        assert!(!is_complete_pdf(b"%PDF-1.4\nbody"));
        assert!(!is_complete_pdf(b"not a pdf\n%%EOF"));
    }

    #[test]
    fn remaps_annotations_after_crop() {
        let crop = NormalizedRect {
            x: 0.25,
            y: 0.25,
            width: 0.5,
            height: 0.5,
        };
        let rect = NormalizedRect {
            x: 0.5,
            y: 0.5,
            width: 0.1,
            height: 0.1,
        };
        assert_eq!(
            remap(rect, crop),
            NormalizedRect {
                x: 0.5,
                y: 0.5,
                width: 0.2,
                height: 0.2
            }
        );
    }

    #[test]
    fn crop_preserves_the_source_aspect_inside_the_selected_rectangle() {
        let image: RgbaImage = ImageBuffer::from_pixel(200, 100, Rgba([20, 40, 60, 255]));
        let mut source = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image)
            .write_to(&mut source, ImageFormat::Png)
            .unwrap();
        let rendered = render_annotated_png(
            source.get_ref(),
            &[Annotation {
                id: "crop".into(),
                kind: AnnotationKind::Crop,
                rect: NormalizedRect {
                    x: 0.25,
                    y: 0.25,
                    width: 0.5,
                    height: 0.5,
                },
                color: "#EF4444".into(),
                label: None,
                stroke_width: 2.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 0,
                marker_size: 18.0,
                protected: false,
            }],
        )
        .unwrap();
        let cropped = image::load_from_memory(&rendered).unwrap();
        assert_eq!(cropped.dimensions(), (100, 50));
    }

    #[test]
    fn renders_dark_theme_with_escaped_project_content() {
        let temp = tempfile::tempdir().unwrap();
        let storage = StorageService::new(temp.path().to_path_buf()).unwrap();
        let mut project = storage.create_project("<script>alert(1)</script>").unwrap();
        project.description = "Use <Save> & continue".into();
        project.theme.preset = ReportTheme::CrumbtrailDark;
        let image: RgbaImage = ImageBuffer::from_pixel(24, 16, Rgba([240, 230, 210, 255]));
        let mut bytes = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image)
            .write_to(&mut bytes, ImageFormat::Png)
            .unwrap();
        let asset = storage
            .write_asset(&project.id, "frame.png", bytes.get_ref())
            .unwrap();
        let mut step = Step::manual(asset.clone());
        step.application = Some("Crumbtrail Test App".into());
        step.application_icon_asset = Some(asset);
        project.steps.push(step);
        storage.autosave(&project).unwrap();
        let (html, warnings) = render_html(&storage, &project).unwrap();
        assert!(warnings.is_empty());
        assert!(html.contains("theme-dark"));
        assert!(html.contains("size:A4 portrait"));
        assert!(html.contains("body{margin:0;background:var(--canvas)"));
        assert!(html.contains("ol{display:block;margin:11mm 0 0}"));
        assert!(html.contains("&lt;script&gt;alert(1)&lt;&#x2F;script&gt;"));
        assert!(!html.contains("<script>alert(1)</script>"));
        assert!(html.contains("data:image/png;base64,"));
        assert!(html.contains("class=\"step-marker\""));
        assert!(html.contains("alt=\"Crumbtrail Test App\""));

        let (pdf_html, pdf_warnings) =
            render_html_with_mode(&storage, &project, ReportImageMode::PdfJpeg).unwrap();
        assert!(pdf_warnings.is_empty());
        assert!(pdf_html.contains("data:image/jpeg;base64,"));
        assert!(pdf_html.contains("@page{size:A4 portrait;margin:0;background:var(--paper)}"));
        assert!(pdf_html.contains("body::before"));
        assert!(pdf_html.contains("position:fixed;inset:0;background:var(--paper)"));
        assert!(pdf_html.contains("padding:15mm 14mm 14mm"));
        assert!(pdf_html
            .contains(".step+.step{break-before:page;page-break-before:always;padding-top:15mm}"));
        assert!(pdf_html.contains("break-inside:avoid-page;page-break-inside:avoid"));
        assert!(pdf_html.contains("figure img{max-height:210mm}"));
        assert!(pdf_html.contains("background:var(--paper)!important"));
    }

    #[test]
    fn report_uses_white_numbering_accent_divider_and_optional_branding() {
        let temp = tempfile::tempdir().unwrap();
        let storage = StorageService::new(temp.path().to_path_buf()).unwrap();
        let mut project = storage.create_project("Anleitung").unwrap();
        project.theme.report_locale = "de".into();

        let (html, warnings) = render_html(&storage, &project).unwrap();
        assert!(warnings.is_empty());
        assert!(html.contains("header{padding-bottom:34px;border-bottom:3px solid var(--accent)}"));
        assert!(html.contains("<span>0 Schritte</span>"));
        assert!(html.contains(".step-number{border-radius:999px;background:#fff;color:#25231f"));
        assert!(html.contains(".step-marker span{"));
        assert!(html.contains("background:#fff;color:#25231f"));
        assert!(html.contains("<img class=\"crumbtrail-mark\" src=\"data:image/png;base64,"));
        assert!(html.contains("Erstellt mit Crumbtrail"));
        assert!(!html.contains("Lokal mit Crumbtrail"));

        project.theme.show_crumbtrail_branding = false;
        let (without_branding, warnings) = render_html(&storage, &project).unwrap();
        assert!(warnings.is_empty());
        assert!(!without_branding.contains("<footer>"));
        assert!(!without_branding.contains("Erstellt mit Crumbtrail"));
    }

    #[test]
    fn pdf_images_are_resized_and_smaller_than_lossless_report_images() {
        let image: RgbaImage = ImageBuffer::from_fn(1800, 900, |x, y| {
            Rgba([
                (x.wrapping_mul(17).wrapping_add(y * 3) % 255) as u8,
                (x.wrapping_mul(5).wrapping_add(y * 11) % 255) as u8,
                (x.wrapping_add(y * 7) % 255) as u8,
                255,
            ])
        });
        let mut source = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image)
            .write_to(&mut source, ImageFormat::Png)
            .unwrap();

        let png = render_step_png(source.get_ref(), &[], None).unwrap();
        let jpeg = render_step_pdf_jpeg(source.get_ref(), &[], None).unwrap();
        assert!(jpeg.len() < png.len());
        assert_eq!(
            image::load_from_memory(&jpeg).unwrap().dimensions(),
            (1600, 800)
        );
    }

    #[test]
    #[ignore = "manual Edge PDF rendering fixture"]
    fn renders_dark_pdf_qa_fixture() {
        let destination = std::env::var_os("CRUMBTRAIL_PDF_QA_PATH")
            .map(PathBuf::from)
            .expect("CRUMBTRAIL_PDF_QA_PATH must be set");
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let temp = tempfile::tempdir().unwrap();
        let storage = StorageService::new(temp.path().to_path_buf()).unwrap();
        let mut project = storage.create_project("Dark PDF verification").unwrap();
        project.description = "Full-page dark background and compressed screenshots".into();
        project.theme.preset = ReportTheme::CrumbtrailDark;

        for index in 0..3 {
            let image: RgbaImage = ImageBuffer::from_fn(2560, 1440, |x, y| {
                let panel = if (x / 320 + y / 180 + index) % 2 == 0 {
                    28
                } else {
                    48
                };
                Rgba([
                    panel + (x % 31) as u8,
                    panel + (y % 23) as u8,
                    panel + ((x + y) % 17) as u8,
                    255,
                ])
            });
            let mut bytes = Cursor::new(Vec::new());
            DynamicImage::ImageRgba8(image)
                .write_to(&mut bytes, ImageFormat::Png)
                .unwrap();
            let asset = storage
                .write_asset(&project.id, &format!("frame-{index}.png"), bytes.get_ref())
                .unwrap();
            let mut step = Step::manual(asset);
            step.instruction = format!("Verify dark PDF step {}", index + 1);
            project.steps.push(step);
        }

        let result = export(
            &storage,
            &ExportRequest {
                project,
                format: ExportFormat::Pdf,
                destination: destination.to_string_lossy().into(),
                include_annotated_images: true,
                include_raw_images: false,
            },
        )
        .unwrap();
        assert_eq!(result.files_written, 1);
        assert!(fs::metadata(destination).unwrap().len() < 3_000_000);
    }

    #[test]
    fn image_folder_export_sanitizes_names_and_writes_both_variants() {
        let temp = tempfile::tempdir().unwrap();
        let storage = StorageService::new(temp.path().to_path_buf()).unwrap();
        let mut project = storage.create_project("Images").unwrap();
        let image: RgbaImage = ImageBuffer::from_pixel(12, 12, Rgba([10, 20, 30, 255]));
        let mut bytes = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image)
            .write_to(&mut bytes, ImageFormat::Png)
            .unwrap();
        let asset = storage
            .write_asset(&project.id, "frame.png", bytes.get_ref())
            .unwrap();
        let mut step = Step::manual(asset);
        step.instruction = "Click: Save / Continue?".into();
        project.steps.push(step);
        storage.autosave(&project).unwrap();
        let destination = temp.path().join("exported");
        let result = export(
            &storage,
            &ExportRequest {
                project,
                format: ExportFormat::Images,
                destination: destination.to_string_lossy().into(),
                include_annotated_images: true,
                include_raw_images: true,
            },
        )
        .unwrap();
        assert_eq!(result.files_written, 2);
        assert!(destination.join("001-click-save-continue.png").exists());
        assert!(destination.join("001-click-save-continue-raw.png").exists());
    }

    #[test]
    fn arrow_stroke_width_changes_exported_pixels() {
        let image: RgbaImage = ImageBuffer::from_pixel(600, 300, Rgba([255, 255, 255, 255]));
        let mut source = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image)
            .write_to(&mut source, ImageFormat::Png)
            .unwrap();
        let render = |stroke_width| {
            render_annotated_png(
                source.get_ref(),
                &[Annotation {
                    id: format!("arrow-{stroke_width}"),
                    kind: AnnotationKind::Arrow,
                    rect: NormalizedRect {
                        x: 0.1,
                        y: 0.35,
                        width: 0.8,
                        height: 0.3,
                    },
                    color: "#EF4444".into(),
                    label: None,
                    stroke_width,
                    rotation: 15.0,
                    opacity: 1.0,
                    z_index: 0,
                    marker_size: 18.0,
                    protected: false,
                }],
            )
            .unwrap()
        };
        let colored_pixels = |bytes: &[u8]| {
            image::load_from_memory(bytes)
                .unwrap()
                .to_rgba8()
                .pixels()
                .filter(|pixel| pixel.0 != [255, 255, 255, 255])
                .count()
        };
        let thin = render(2.0);
        let thick = render(10.0);
        assert!(colored_pixels(&thick) > colored_pixels(&thin) * 3);
    }

    #[test]
    fn blur_is_flattened_into_exported_pixels() {
        let image: RgbaImage = ImageBuffer::from_fn(32, 32, |x, y| {
            if (x + y) % 2 == 0 {
                Rgba([0, 0, 0, 255])
            } else {
                Rgba([255, 255, 255, 255])
            }
        });
        let mut source = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image)
            .write_to(&mut source, ImageFormat::Png)
            .unwrap();
        let blurred = render_annotated_png(
            source.get_ref(),
            &[Annotation {
                id: "blur".into(),
                kind: AnnotationKind::Blur,
                rect: NormalizedRect {
                    x: 0.0,
                    y: 0.0,
                    width: 1.0,
                    height: 1.0,
                },
                color: "#000000".into(),
                label: None,
                stroke_width: 0.0,
                rotation: 0.0,
                opacity: 1.0,
                z_index: 0,
                marker_size: 22.0,
                protected: false,
            }],
        )
        .unwrap();
        assert_ne!(blurred, source.into_inner());
    }
}
