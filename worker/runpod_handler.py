"""
RunPod Serverless Handler cho Karaoke Studio.
Chạy theo cơ chế Serverless (Scale to Zero khi không có yêu cầu).
"""

import os
import runpod
from worker import get_supabase, process_job

supabase = get_supabase()


def runpod_handler(job):
    """
    RunPod Serverless trigger.
    Job input: {"job_id": "..."} hoặc worker tự query Supabase.
    """
    job_input = job.get("input", {})
    target_job_id = job_input.get("job_id")

    if target_job_id:
        res = supabase.table("jobs").select("*").eq("id", target_job_id).single().execute()
        if res.data:
            process_job(supabase, res.data)
            return {"status": "success", "job_id": target_job_id}
    else:
        # Tự động lấy job đang queued trong Supabase
        res = supabase.table("jobs").select("*").eq("status", "queued").order("created_at").limit(1).execute()
        if res.data:
            j = res.data[0]
            process_job(supabase, j)
            return {"status": "success", "job_id": j["id"]}

    return {"status": "no_job_found"}


if __name__ == "__main__":
    runpod.serverless.start({"handler": runpod_handler})
