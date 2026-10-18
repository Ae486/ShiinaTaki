//! INPUT:  fixed registered Windows installation and post-gate C1 invocation authority
//! OUTPUT: protected artifact lifetime and one bounded hidden credential-preparation subprocess
//! POS:    shell/hindsight_windows — supported Windows OS primitives; no service install or Native lifecycle

mod acl;
mod objects;
mod catalog;
mod process;
mod installation;
mod invoke;
mod deployment;
mod resident;
pub(crate) use deployment::DeploymentInstallation;
pub(crate) use installation::VerifiedInstallation;
pub(crate) use invoke::prepare;
#[cfg(test)]
mod tests;
